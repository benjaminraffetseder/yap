package models

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestMissingCustomRuntimeDoesNotInstallOrOverwrite(t *testing.T) {
	selected := filepath.Join(t.TempDir(), "custom-whisper")
	path, err := EnsureRuntime(context.Background(), t.TempDir(), selected, func(int64, int64) {})
	if err == nil || path != selected {
		t.Fatal("custom selection replaced or falsely ready", path, err)
	}
}

func TestManagedWhisperRuntimeRecognizesCurrentAndLegacyVersionsOnly(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		name    string
		path    string
		managed bool
	}{
		{"current", filepath.Join(dir, "runtime", "whisper-"+WhisperRuntimeVersion, "bin", whisperExecutableName()), true},
		{"legacy", filepath.Join(dir, "runtime", "whisper-1.9.2", "bin", whisperExecutableName()), true},
		{"lookalike", filepath.Join(dir, "runtime", "whisper-1.9.20", "bin", whisperExecutableName()), false},
		{"custom", filepath.Join(dir, "custom-whisper", whisperExecutableName()), false},
		{"escaped", filepath.Join(dir, "runtime", "whisper-1.9.2", "..", "custom", whisperExecutableName()), false},
		{"version directory", filepath.Join(dir, "runtime", "whisper-1.9.2"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsManagedRuntime(dir, tc.path); got != tc.managed {
				t.Fatalf("IsManagedRuntime(%q) = %v; want %v", tc.path, got, tc.managed)
			}
		})
	}
}

func TestManagedRuntimeDoesNotReuseBrokenExecutable(t *testing.T) {
	if _, ok := whisperRuntimes[runtime.GOOS+"/"+runtime.GOARCH]; !ok {
		t.Skip("no managed runtime for this platform")
	}
	dir, dest, _ := runtimeFixture(t, map[string]string{})
	path := filepath.Join(dest, whisperExecutableName())
	os.WriteFile(path, []byte("damaged executable"), 0600)
	requests := 0
	old := http.DefaultTransport
	http.DefaultTransport = runtimeTransport(func(*http.Request) (*http.Response, error) {
		requests++
		return nil, errors.New("repair download attempted")
	})
	defer func() { http.DefaultTransport = old }()
	if _, err := EnsureRuntime(context.Background(), dir, path, func(int64, int64) {}); err == nil || requests != 1 {
		t.Fatal("broken runtime reused", err, requests)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "damaged executable" {
		t.Fatal("failed repair changed previous runtime")
	}
}
