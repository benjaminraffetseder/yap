package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"yap/internal/inference/speech"
	"yap/internal/models"
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

func TestWhisperRuntimeUpdateMigratesOnlyManagedSelection(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("macOS uses bundled Whisper instead of managed runtime downloads")
	}
	for _, custom := range []bool{false, true} {
		t.Run(map[bool]string{false: "managed", true: "custom"}[custom], func(t *testing.T) {
			a := testApp(t)
			self, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(self)
			if err != nil {
				t.Fatal(err)
			}
			name := filepath.Base(self)
			if filepath.Ext(name) == ".exe" {
				name = "whisper-cli.exe"
			} else {
				name = "whisper-cli"
			}
			current := filepath.Join(a.store.Dir, "runtime", "whisper-"+models.WhisperRuntimeVersion, name)
			legacy := filepath.Join(a.store.Dir, "runtime", "whisper-1.9.2")
			for _, folder := range []string{filepath.Dir(current), legacy} {
				if err := os.MkdirAll(folder, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(current, data, 0700); err != nil {
				t.Fatal(err)
			}
			a.settings.WhisperPath = filepath.Join(legacy, name)
			if custom {
				a.settings.WhisperPath = self
			}
			before := a.settings
			if err := a.store.SaveSettings(before); err != nil {
				t.Fatal(err)
			}
			if err := a.UpdateModelRuntime("tiny"); err != nil {
				t.Fatal(err)
			}
			a.wg.Wait()
			if a.status.Phase != "idle" || a.status.Message != "Speech runtime updated." {
				t.Fatal(a.status)
			}
			want := before
			if !custom {
				want.WhisperPath = current
			}
			stored, err := a.store.Settings()
			if err != nil || stored != want || a.settings != want {
				t.Fatal("runtime update changed preferences or failed to persist selected path", stored, a.settings, err)
			}
			if _, err := os.Stat(legacy); !os.IsNotExist(err) {
				t.Fatal("old runtime remains", err)
			}
		})
	}
}

func TestWhisperRuntimeUpdatePreservesCustomAliasIntoLegacyRuntime(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("macOS uses bundled Whisper instead of managed runtime downloads")
	}
	a := testApp(t)
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	name := "whisper-cli"
	if filepath.Ext(self) == ".exe" {
		name += ".exe"
	}
	current := filepath.Join(a.store.Dir, "runtime", "whisper-"+models.WhisperRuntimeVersion, name)
	legacy := filepath.Join(a.store.Dir, "runtime", "whisper-1.9.2", name)
	for _, path := range []string{current, legacy} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0700); err != nil {
			t.Fatal(err)
		}
	}
	alias := filepath.Join(a.store.Dir, name)
	if err := os.Symlink(legacy, alias); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	a.settings.WhisperPath = alias
	if err := a.UpdateModelRuntime("tiny"); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if a.status.Phase != "error" || !strings.Contains(a.status.Message, "old runtime has been kept") {
		t.Fatal("custom alias did not prevent cleanup", a.status)
	}
	if a.settings.WhisperPath != alias {
		t.Fatal("custom selection was replaced")
	}
	if _, err := os.Stat(alias); err != nil {
		t.Fatal("custom alias became dangling", err)
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
