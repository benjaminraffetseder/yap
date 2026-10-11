package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"yap/internal/updates"
)

func TestUpdateVersionMatchesBuildMetadata(t *testing.T) {
	data, err := os.ReadFile("wails.json")
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Info struct{ ProductVersion string }
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if appVersion() == "" || appVersion() != config.Info.ProductVersion {
		t.Fatalf("update version %q differs from native metadata %q", appVersion(), config.Info.ProductVersion)
	}
}

func TestUpdateCheckPreservesRecordingAndDevelopmentSkipsNetwork(t *testing.T) {
	if !updatesSupported() {
		t.Skip("Windows x64 update checks")
	}
	a := testApp(t)
	a.updateChecker = updates.New(appVersion(), updateRepository, filepath.Join(a.store.Dir, "update-check.json"))
	a.development = true
	before := a.status
	s, err := a.CheckForUpdates(false)
	if err != nil || s.Error != "" || s.CheckedAt != "" {
		t.Fatalf("development build checked the network: %+v, %v", s, err)
	}
	if !reflect.DeepEqual(a.status, before) {
		t.Fatal("automatic check changed dictation state")
	}
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	before = a.status
	// An invalid repository fails locally without using the network.
	a.updateChecker = updates.New(appVersion(), "invalid repository", filepath.Join(a.store.Dir, "update-check.json"))
	s, err = a.CheckForUpdates(true)
	if err != nil || s.Error == "" || !reflect.DeepEqual(before, a.status) {
		t.Fatalf("failed check interrupted recording: %+v, %v, %+v", s, err, a.status)
	}
}

func TestUpdateDownloadUsesOnlyKnownInstallerAndLeavesAppRunning(t *testing.T) {
	if !updatesSupported() {
		t.Skip("Windows x64 update checks")
	}
	a := testApp(t)
	repository := "owner/yap"
	path := filepath.Join(a.store.Dir, "update-check.json")
	data := []byte(`{"repository":"` + repository + `","lastSuccess":"` + time.Now().UTC().Format(time.RFC3339) + `","release":{"version":"99.0.0","tag":"v99.0.0","installer":"yap-99.0.0-windows-amd64-setup.exe","downloadURL":"https://github.com/owner/yap/releases/download/v99.0.0/yap-99.0.0-windows-amd64-setup.exe"}}`)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	a.updateChecker = updates.New(appVersion(), repository, path)
	opened := ""
	err := a.openUpdateDownload(func(ctx context.Context, url string) { opened = url })
	if err != nil || opened != "https://github.com/owner/yap/releases/download/v99.0.0/yap-99.0.0-windows-amd64-setup.exe" || a.quitRequested {
		t.Fatalf("unexpected download action: %q, %v", opened, err)
	}
	a.updateChecker = updates.New("99.0.0", repository, path)
	if err := a.openUpdateDownload(func(context.Context, string) { t.Fatal("opened installed version") }); err == nil {
		t.Fatal("allowed download without a newer release")
	}
	a.shutdown(a.ctx)
	if _, err := a.CheckForUpdates(true); err == nil {
		t.Fatal("checked updates after shutdown")
	}
}
