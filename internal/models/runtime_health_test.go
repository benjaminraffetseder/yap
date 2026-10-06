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

func TestManagedRuntimeDoesNotReuseBrokenExecutable(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("managed Windows runtime")
	}
	dir, dest, _ := runtimeFixture(t, map[string]string{})
	path := filepath.Join(dest, "whisper-cli.exe")
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
