package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"yap/internal/updates"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"gopkg.in/yaml.v3"
)

func TestUpdateVersionMatchesBuildMetadata(t *testing.T) {
	data, err := os.ReadFile("build/config.yml")
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Info struct {
			Version string `yaml:"version"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if appVersion() == "" || appVersion() != config.Info.Version {
		t.Fatalf("update version %q differs from native metadata %q", appVersion(), config.Info.Version)
	}
	nativeData, err := os.ReadFile("build/windows/info.json")
	if err != nil {
		t.Fatal(err)
	}
	var native struct {
		Fixed struct {
			Version string `json:"file_version"`
		} `json:"fixed"`
		Info map[string]struct{ FileVersion, ProductVersion string }
	}
	if err := json.Unmarshal(nativeData, &native); err != nil {
		t.Fatal(err)
	}
	if native.Fixed.Version != appVersion() {
		t.Fatal("Windows version metadata differs from build/config.yml")
	}
	if native.Info["0409"].FileVersion != appVersion() || native.Info["0409"].ProductVersion != appVersion() {
		t.Fatal("Windows string version metadata differs from build/config.yml")
	}
	for _, path := range []string{"build/darwin/Info.plist", "build/darwin/Info.dev.plist", "build/windows/wails.exe.manifest"} {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "{{") {
			t.Fatalf("%s still contains v2 template syntax", path)
		}
		decoder := xml.NewDecoder(strings.NewReader(string(data)))
		for {
			_, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("%s: %v", path, err)
			}
		}
		if !strings.Contains(string(data), appVersion()) || !strings.Contains(string(data), "com.yap.desktop") {
			t.Fatalf("%s lost the application version or identity", path)
		}
		if strings.HasSuffix(path, ".plist") && !strings.Contains(string(data), "NSMicrophoneUsageDescription") {
			t.Fatalf("%s lost the microphone permission description", path)
		}
	}
}

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
	state                      updater.State
	checks, installs, restarts int
	checkError, installError   error
	installContext             context.Context
	install                    func(context.Context) error
}

func (e *testUpdateEngine) State() updater.State { return e.state }
func (e *testUpdateEngine) Check(context.Context) (*updater.Release, error) {
	e.checks++
	return nil, e.checkError
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
	a.updateChecker = updates.New(appVersion(), updateRepository, filepath.Join(a.store.Dir, "update-check.json"), engine)
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

func TestConfigureWailsUpdaterUsesBuildVersion(t *testing.T) {
	if !updatesSupported() {
		t.Skip("packaged update platforms")
	}
	engine := updater.New(nil)
	if err := configureUpdater(engine); err != nil {
		t.Fatal(err)
	}
	if engine.CurrentVersion() != appVersion() || engine.State() != updater.StateIdle {
		t.Fatal("Wails updater was not configured with the embedded version")
	}
}
