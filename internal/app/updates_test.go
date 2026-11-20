package app

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"yap/internal/updates"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestUpdateCheckPreservesRecordingAndDevelopmentSkipsNetwork(t *testing.T) {
	if !updatesSupported() {
		t.Skip("packaged update platforms")
	}
	a := testApp(t)
	engine := &testUpdateEngine{checkError: errors.New("offline")}
	setTestUpdater(a, engine)
	a.development = true
	before := a.status
	s, err := a.CheckForUpdates(false)
	if err != nil || s.Error != "" || s.CheckedAt != "" || engine.checks != 0 {
		t.Fatalf("development build checked the network: %+v, %v", s, err)
	}
	if !reflect.DeepEqual(a.status, before) {
		t.Fatal("automatic check changed dictation state")
	}
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	before = a.status
	s, err = a.CheckForUpdates(true)
	if err != nil || s.Error == "" || engine.checks != 1 || !reflect.DeepEqual(before, a.status) {
		t.Fatalf("failed check interrupted recording: %+v, %v, %+v", s, err, a.status)
	}
}

type testUpdateEngine struct {
	release                    *updater.Release
	state                      updater.State
	checks, installs, restarts int
	checkError, installError   error
	installContext             context.Context
	install                    func(context.Context) error
}

func (e *testUpdateEngine) State() updater.State { return e.state }
func (e *testUpdateEngine) Check(context.Context) (*updater.Release, error) {
	e.checks++
	return e.release, e.checkError
}
func (e *testUpdateEngine) CheckAndInstall(ctx context.Context) error {
	e.installs++
	e.installContext = ctx
	if e.install != nil {
		return e.install(ctx)
	}
	return e.installError
}
func (e *testUpdateEngine) Restart(context.Context) error {
	e.restarts++
	return nil
}

func setTestUpdater(a *App, engine updates.Engine) {
	a.updateChecker = updates.NewForPlatform(a.version, a.updateRepository, filepath.Join(a.store.Dir, "update-check.json"), engine, "windows", "amd64")
	a.updateContext, a.updateCancel = context.WithCancel(a.ctx)
}

func TestUpdateInstallUsesWailsAndKeepsWindowContextAlive(t *testing.T) {
	if !updatesSupported() {
		t.Skip("packaged update platforms")
	}
	a := testApp(t)
	engine := &testUpdateEngine{}
	setTestUpdater(a, engine)
	if err := a.InstallUpdate(); err != nil || engine.installs != 1 || a.quitRequested {
		t.Fatalf("unexpected install action: %v, %+v", err, engine)
	}
	if engine.installContext.Err() != nil {
		t.Fatal("staging cancelled the native window's retry/restart context")
	}
	engine.installError = errors.New("download failed")
	if err := a.InstallUpdate(); !errors.Is(err, engine.installError) {
		t.Fatalf("install failure hidden: %v", err)
	}
	engine.state = updater.StateReady
	if _, err := a.CheckForUpdates(true); err == nil {
		t.Fatal("rechecked over a staged update")
	}
	if err := a.InstallUpdate(); err == nil {
		t.Fatal("redownloaded a staged update")
	}
	if s, err := a.GetUpdateStatus(); err != nil || !s.Ready {
		t.Fatalf("staged update missing: %+v, %v", s, err)
	}
	if err := a.RestartUpdate(); err != nil || engine.restarts != 1 {
		t.Fatalf("restart not delegated: %v", err)
	}
	a.development = true
	if err := a.InstallUpdate(); err == nil {
		t.Fatal("installed over a development build")
	}
	if err := a.RestartUpdate(); err == nil {
		t.Fatal("restarted a development build")
	}
	a.shutdown(a.ctx)
	if engine.installContext.Err() == nil {
		t.Fatal("shutdown left updater context running")
	}
	if _, err := a.CheckForUpdates(true); err == nil {
		t.Fatal("checked updates after shutdown")
	}
	if err := a.InstallUpdate(); err == nil {
		t.Fatal("installed after shutdown")
	}
}

func TestShutdownCancelsUpdateAndRejectsConcurrentOperations(t *testing.T) {
	if !updatesSupported() {
		t.Skip("packaged update platforms")
	}
	a := testApp(t)
	started := make(chan struct{})
	engine := &testUpdateEngine{install: func(ctx context.Context) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}}
	setTestUpdater(a, engine)
	done := make(chan error, 1)
	go func() { done <- a.InstallUpdate() }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("install never started")
	}
	if err := a.InstallUpdate(); err == nil {
		t.Fatal("allowed concurrent install")
	}
	if _, err := a.CheckForUpdates(true); err == nil {
		t.Fatal("allowed check during install")
	}
	a.shutdown(a.ctx)
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("install was not cancelled: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown did not cancel update")
	}
}

func TestUpdaterUsesSuppliedReleaseMetadata(t *testing.T) {
	if !updatesSupported() {
		t.Skip("packaged update platforms")
	}
	for _, repository := range []string{"owner/yap", ""} {
		t.Run(repository, func(t *testing.T) {
			a := testApp(t)
			a.updateRepository = repository
			engine := updater.New(nil)
			a.desktop = &application.App{Updater: engine}
			if err := a.configureUpdater(engine); err != nil {
				t.Fatal(err)
			}
			version := ""
			state := updater.StateUnconfigured
			if repository != "" {
				version = a.version
				state = updater.StateIdle
			}
			if engine.CurrentVersion() != version || engine.State() != state {
				t.Fatal("Wails updater did not respect the supplied release metadata")
			}
			status, err := a.GetUpdateStatus()
			if err != nil || status.CurrentVersion != a.version || status.Configured != (repository != "") {
				t.Fatalf("update status lost the release configuration: %+v, %v", status, err)
			}
			if repository == "" {
				if err := a.InstallUpdate(); err == nil {
					t.Fatal("installed an update with no repository configured")
				}
				if err := a.RestartUpdate(); err == nil {
					t.Fatal("restarted an update with no repository configured")
				}
			}
		})
	}
}

func TestLinuxPackageDownloadRechecksWithoutStagingOrRestarting(t *testing.T) {
	engine := &testUpdateEngine{release: &updater.Release{
		Version: "99.0.0", Artifact: updater.Artifact{Filename: "yap-99.0.0-linux-amd64.deb"},
		Metadata: map[string]any{"github.release.tag": "v99.0.0"},
	}}
	checker := updates.NewForPlatform("0.11.0", "owner/yap", filepath.Join(t.TempDir(), "updates.json"), engine, "linux", "amd64")
	checker.Check(context.Background(), true)
	opened := ""
	open := func(_ context.Context, url string) error { opened = url; return nil }
	if err := openPackageUpdate(context.Background(), checker, open); err != nil {
		t.Fatal(err)
	}
	if opened != "https://github.com/owner/yap/releases/download/v99.0.0/yap-99.0.0-linux-amd64.deb" || engine.checks != 2 || engine.installs != 0 || engine.restarts != 0 {
		t.Fatalf("incorrect package download: %q, %+v", opened, engine)
	}
	engine.checkError = errors.New("offline")
	opened = ""
	if err := openPackageUpdate(context.Background(), checker, open); err == nil || opened != "" {
		t.Fatal("opened a cached download after a failed recheck")
	}
	engine.checkError = nil
	browserError := errors.New("browser unavailable")
	if err := openPackageUpdate(context.Background(), checker, func(context.Context, string) error { return browserError }); !errors.Is(err, browserError) {
		t.Fatalf("browser error hidden: %v", err)
	}
}
