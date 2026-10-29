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
	err := a.openUpdateDownload(func(ctx context.Context, url string) error { opened = url; return nil })
	if err != nil || opened != "https://github.com/owner/yap/releases/download/v99.0.0/yap-99.0.0-windows-amd64-setup.exe" || a.quitRequested {
		t.Fatalf("unexpected download action: %q, %v", opened, err)
	}
	launchError := errors.New("browser launch failed")
	if err := a.openUpdateDownload(func(context.Context, string) error { return launchError }); !errors.Is(err, launchError) {
		t.Fatalf("browser launch failure was hidden: %v", err)
	}
	a.updateChecker = updates.New("99.0.0", repository, path)
	if err := a.openUpdateDownload(func(context.Context, string) error { t.Fatal("opened installed version"); return nil }); err == nil {
		t.Fatal("allowed download without a newer release")
	}
	a.shutdown(a.ctx)
	if _, err := a.CheckForUpdates(true); err == nil {
		t.Fatal("checked updates after shutdown")
	}
}
