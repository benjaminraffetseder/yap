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

func textUpdateFixture(t *testing.T, backend string) string {
	t.Helper()
	dir := t.TempDir()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"cpu", "vulkan"} {
		legacy := filepath.Join(dir, "runtime", "llama-b12110-"+kind)
		if err := os.MkdirAll(legacy, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(legacy, "keep"), []byte("previous"), 0600); err != nil {
			t.Fatal(err)
		}
		if kind == "vulkan" && backend == "cpu" {
			continue
		}
		path := TextRuntimePath(dir, kind)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0700); err != nil {
			t.Fatal(err)
		}
		if runtime.GOOS == "windows" {
			for _, name := range textCRTFiles {
				if err := os.WriteFile(filepath.Join(filepath.Dir(path), name), []byte("app-local dependency fixture"), 0600); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	return dir
}

func TestTextRuntimeUpdateCleansBothBackendsAfterValidation(t *testing.T) {
	if !TextRuntimeAvailable() {
		t.Skip("no managed text runtime for this platform")
	}
	dir := textUpdateFixture(t, "both")
	if !RuntimeUpdateAvailable(dir, "text") {
		t.Fatal("legacy text runtime was not detected")
	}
	if err := UpdateTextRuntime(context.Background(), dir, func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	if RuntimeUpdateAvailable(dir, "text") {
		t.Fatal("old text runtime was not removed")
	}
	for _, backend := range []string{"cpu", "vulkan"} {
		if _, err := os.Stat(TextRuntimePath(dir, backend)); err != nil {
			t.Fatal("replacement was removed", err)
		}
	}
}

func TestTextRuntimeUpdateRetainsOldBackendsWhenVulkanReplacementFails(t *testing.T) {
	if !TextRuntimeAvailable() {
		t.Skip("no managed text runtime for this platform")
	}
	dir := textUpdateFixture(t, "cpu")
	oldTransport := http.DefaultTransport
	http.DefaultTransport = runtimeTransport(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("synthetic replacement download failure")
	})
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	if err := UpdateTextRuntime(context.Background(), dir, func(int64, int64) {}); err == nil {
		t.Fatal("missing Vulkan replacement reported a completed update")
	}
	for _, backend := range []string{"cpu", "vulkan"} {
		keep := filepath.Join(dir, "runtime", "llama-b12110-"+backend, "keep")
		if data, err := os.ReadFile(keep); err != nil || string(data) != "previous" {
			t.Fatal("failed replacement removed previous backend", backend, err)
		}
	}
}

func TestTextRuntimeUpdateMetadataOnlyForInstalledModels(t *testing.T) {
	dir := t.TempDir()
	legacy := filepath.Join(dir, "runtime", "llama-b12110-cpu")
	if err := os.MkdirAll(legacy, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "models"), 0700); err != nil {
		t.Fatal(err)
	}
	previous := TextCatalog
	TextCatalog = []TextModel{{ID: "fixture", Filename: "fixture.gguf", Size: 4}}
	t.Cleanup(func() { TextCatalog = previous })
	if ListTextModels(dir)[0].RuntimeUpdateAvailable {
		t.Fatal("offered a runtime update for a model that is not installed")
	}
	if err := os.WriteFile(filepath.Join(dir, "models", "fixture.gguf"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	model := ListTextModels(dir)[0]
	if !model.Installed || !model.RuntimeUpdateAvailable {
		t.Fatal("installed model lost runtime update metadata", model)
	}
}
