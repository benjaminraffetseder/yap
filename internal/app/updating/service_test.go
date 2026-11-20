package updating

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"yap/internal/updates"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

type testEngine struct {
	release                    *updater.Release
	state                      updater.State
	checks, installs, restarts int
	checkError                 error
	installContext             context.Context
	restartContext             context.Context
}

func (e *testEngine) State() updater.State { return e.state }
func (e *testEngine) Check(context.Context) (*updater.Release, error) {
	e.checks++
	return e.release, e.checkError
}
func (e *testEngine) CheckAndInstall(ctx context.Context) error {
	e.installs++
	e.installContext = ctx
	return nil
}
func (e *testEngine) Restart(ctx context.Context) error {
	e.restarts++
	e.restartContext = ctx
	return nil
}

func testService(t *testing.T, repository string, engine *testEngine) *Service {
	t.Helper()
	s := &Service{}
	s.Initialize(nil, updates.NewForPlatform("1.2.3", repository, filepath.Join(t.TempDir(), "updates.json"), engine, "windows", "amd64"))
	t.Cleanup(s.Cancel)
	return s
}

func TestServiceReservesOperationsAndKeepsStagedContextAlive(t *testing.T) {
	if !Supported() {
		t.Skip("packaged update platforms")
	}
	engine := &testEngine{}
	s := testService(t, "owner/yap", engine)
	policy := Policy{Repository: "owner/yap"}
	check, err := s.BeginCheck(true, false)
	if err != nil || check == nil || engine.checks != 0 {
		t.Fatalf("check ran before the application released its lock: %v, %+v", err, engine)
	}
	if _, err := s.BeginCheck(true, false); err == nil || err.Error() != "an update is already in progress; use the Yap Update window" {
		t.Fatalf("concurrent check changed its error: %v", err)
	}
	if _, err := s.BeginInstall(policy, nil); err == nil || err.Error() != "an update is already in progress; use the Yap Update window" {
		t.Fatalf("concurrent install changed its error: %v", err)
	}
	if _, err := s.PrepareRestart(policy); err == nil || err.Error() != "an update is not ready to restart" {
		t.Fatalf("restart was accepted during a check: %v", err)
	}
	if status := check(); status.Error != "" || engine.checks != 1 {
		t.Fatalf("prepared check did not run: %+v, %+v", status, engine)
	}
	s.Finish()
	install, err := s.BeginInstall(policy, nil)
	if err != nil || install == nil || engine.installs != 0 {
		t.Fatalf("install ran before the application released its lock: %v, %+v", err, engine)
	}
	if err := install(); err != nil {
		t.Fatal(err)
	}
	s.Finish()
	if engine.installContext == nil || engine.installContext.Err() != nil {
		t.Fatal("finishing staging cancelled the native update window")
	}
	engine.state = updater.StateReady
	if _, err := s.BeginCheck(true, false); err == nil {
		t.Fatal("rechecked over a staged update")
	}
	if _, err := s.BeginInstall(policy, nil); err == nil {
		t.Fatal("redownloaded a staged update")
	}
	if status := s.PrepareStatus()(); !status.Ready || !status.Available {
		t.Fatalf("staged update missing from snapshot: %+v", status)
	}
	restart, err := s.PrepareRestart(policy)
	if err != nil || restart == nil || engine.restarts != 0 {
		t.Fatalf("restart ran before the application released its lock: %v, %+v", err, engine)
	}
	if err := restart(); err != nil || engine.restarts != 1 || engine.restartContext != engine.installContext {
		t.Fatalf("restart lost the native window's lifetime: %v, %+v", err, engine)
	}
	s.Cancel()
	if !errors.Is(engine.installContext.Err(), context.Canceled) {
		t.Fatal("shutdown left the native update window running")
	}
}

func TestServicePreservesDevelopmentAndDisabledRepositoryPolicy(t *testing.T) {
	if !Supported() {
		t.Skip("packaged update platforms")
	}
	engine := &testEngine{state: updater.StateReady}
	s := testService(t, "owner/yap", engine)
	if check, err := s.BeginCheck(false, true); err != nil || check != nil || engine.checks != 0 {
		t.Fatalf("development automatic check did not skip before the busy check: %v", err)
	}
	if _, err := s.BeginInstall(Policy{Repository: "owner/yap", Development: true}, nil); err == nil || err.Error() != "install updates from a packaged Windows, macOS or Linux build" {
		t.Fatalf("development install did not fail before the busy check: %v", err)
	}
	if _, err := s.BeginInstall(Policy{}, nil); err == nil || err.Error() != "install updates from a packaged Windows, macOS or Linux build" {
		t.Fatalf("unconfigured install did not fail before the busy check: %v", err)
	}
	engine = &testEngine{}
	s = testService(t, "", engine)
	check, err := s.BeginCheck(true, false)
	if err != nil || check == nil {
		t.Fatalf("disabled repository check changed behavior: %v", err)
	}
	status := check()
	s.Finish()
	if engine.checks != 0 || status.Configured || status.CurrentVersion != "1.2.3" {
		t.Fatalf("disabled repository made a network request or lost metadata: %+v, %+v", engine, status)
	}
}

func TestLinuxPackageDownloadRechecksWithoutStagingOrRestarting(t *testing.T) {
	if !Supported() {
		t.Skip("packaged update platforms")
	}
	engine := &testEngine{release: &updater.Release{
		Version: "99.0.0", Artifact: updater.Artifact{Filename: "yap-99.0.0-linux-amd64.deb"},
		Metadata: map[string]any{"github.release.tag": "v99.0.0"},
	}}
	checker := updates.NewForPlatform("0.11.0", "owner/yap", filepath.Join(t.TempDir(), "updates.json"), engine, "linux", "amd64")
	checker.Check(context.Background(), true)
	s := &Service{}
	s.Initialize(context.Background(), checker)
	t.Cleanup(s.Cancel)
	policy := Policy{Repository: "owner/yap"}
	install := func(open func(context.Context, string) error) error {
		operation, err := s.BeginInstall(policy, open)
		if err != nil {
			return err
		}
		defer s.Finish()
		return operation()
	}
	opened := ""
	open := func(_ context.Context, url string) error { opened = url; return nil }
	if err := install(open); err != nil {
		t.Fatal(err)
	}
	if opened != "https://github.com/owner/yap/releases/download/v99.0.0/yap-99.0.0-linux-amd64.deb" || engine.checks != 2 || engine.installs != 0 || engine.restarts != 0 {
		t.Fatalf("incorrect package download: %q, %+v", opened, engine)
	}
	if _, err := s.PrepareRestart(policy); err == nil {
		t.Fatal("allowed a Debian update to restart through Wails")
	}
	engine.checkError = errors.New("offline")
	opened = ""
	if err := install(open); err == nil || opened != "" {
		t.Fatal("opened a cached download after a failed recheck")
	}
	engine.checkError = nil
	browserError := errors.New("browser unavailable")
	if err := install(func(context.Context, string) error { return browserError }); !errors.Is(err, browserError) {
		t.Fatalf("browser error hidden: %v", err)
	}
}
