package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yap/internal/inference/speech"
)

func TestRuntimeUpdatePreservesSelectedModelAndSettings(t *testing.T) {
	a := testApp(t)
	before := a.settings
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	current := speech.RuntimePath(a.store.Dir, "parakeet")
	if err := os.MkdirAll(filepath.Dir(current), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(current, data, 0700); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(a.store.Dir, "runtime", "nemo-speech-0.2.0")
	if err := os.MkdirAll(legacy, 0700); err != nil {
		t.Fatal(err)
	}
	if err := a.UpdateModelRuntime("parakeet-tdt-0.6b-v3"); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if a.status.Phase != "idle" || a.status.Message != "Speech runtime updated." {
		t.Fatal("runtime update did not finish successfully", a.status)
	}
	if a.settings != before {
		t.Fatal("updating an inactive model's runtime changed saved selections")
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatal("runtime update left its old directory", err)
	}
}

func TestRuntimeUpdateRejectsBusyAndUnknownModels(t *testing.T) {
	a := testApp(t)
	for _, phase := range []string{"recording", "transcribing", "downloading", "mic-test"} {
		a.status.Phase = phase
		if err := a.UpdateModelRuntime("parakeet-tdt-0.6b-v3"); err == nil {
			t.Fatalf("updated runtime during %s", phase)
		}
	}
	a.status.Phase = "idle"
	if err := a.UpdateModelRuntime("unknown-model"); err == nil {
		t.Fatal("accepted an unknown model")
	}
}

func TestModelInstallRejectsUnavailableCustomRuntime(t *testing.T) {
	a := testApp(t)
	selected := filepath.Join(a.store.Dir, "custom-missing-whisper")
	a.settings.WhisperPath = selected
	previous := a.settings.ModelPath
	if err := a.InstallModel("tiny"); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if a.status.Phase != "error" || strings.Contains(a.status.Message, "Ready to dictate") {
		t.Fatal("unavailable runtime reported ready", a.status)
	}
	if a.settings.WhisperPath != selected || a.settings.ModelPath != previous {
		t.Fatal("failed custom validation changed selections")
	}
}
