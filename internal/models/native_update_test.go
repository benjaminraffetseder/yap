package models

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"yap/internal/inference/speech"
)

func nativeUpdateFixture(t *testing.T) (dir, legacy, model string) {
	t.Helper()
	dir = t.TempDir()
	legacy = filepath.Join(dir, "runtime", "nemo-speech-0.2.0")
	model = filepath.Join(dir, "models", "keep.gguf")
	for _, path := range []string{legacy, filepath.Dir(model), filepath.Join(dir, "runtime", "custom-runtime")} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{filepath.Join(legacy, "keep.txt"), model, filepath.Join(dir, "runtime", "custom-runtime", "keep.txt")} {
		if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return
}

func nativeUpdateArchive(t *testing.T, executable []byte) []byte {
	t.Helper()
	var data bytes.Buffer
	z := zip.NewWriter(&data)
	header := &zip.FileHeader{Name: "bundle/bin/" + filepath.Base(speech.RuntimePath("", "parakeet")), Method: zip.Store}
	header.SetMode(0700)
	entry, err := z.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(executable); err != nil {
		t.Fatal(err)
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func useNativeUpdateAsset(t *testing.T, url string, archive []byte) {
	t.Helper()
	key := "parakeet/" + runtime.GOOS + "/" + runtime.GOARCH
	old, exists := nativeRuntimes[key]
	nativeRuntimes[key] = runtimeAsset{URL: url, SHA: fmt.Sprintf("%x", sha256.Sum256(archive)), Size: int64(len(archive))}
	t.Cleanup(func() {
		if exists {
			nativeRuntimes[key] = old
		} else {
			delete(nativeRuntimes, key)
		}
	})
}

func TestNativeRuntimeUpdateVerifiesReplacementBeforeCleanup(t *testing.T) {
	dir, legacy, model := nativeUpdateFixture(t)
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	// The real test executable handles --help, exercising the loader probe.
	archive := nativeUpdateArchive(t, executable)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, err := os.Stat(filepath.Join(legacy, "keep.txt")); err != nil {
			t.Error("old runtime removed before the replacement was downloaded", err)
		}
		_, _ = w.Write(archive)
	}))
	defer server.Close()
	useNativeUpdateAsset(t, server.URL, archive)
	if !nativeRuntimeUpdateAvailable(dir, "parakeet") {
		t.Fatal("legacy installation did not advertise an update")
	}
	if err := UpdateModelRuntime(context.Background(), dir, "parakeet-tdt-0.6b-v3", func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	if err := checkNativeRuntime(context.Background(), speech.RuntimePath(dir, "parakeet"), "parakeet"); err != nil {
		t.Fatal("replacement cannot start", err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) || nativeRuntimeUpdateAvailable(dir, "parakeet") {
		t.Fatal("superseded runtime remains after update", err)
	}
	for _, path := range []string{model, filepath.Join(dir, "runtime", "custom-runtime", "keep.txt")} {
		if data, err := os.ReadFile(path); err != nil || string(data) != "keep" {
			t.Fatalf("update changed unrelated file %s: %q %v", path, data, err)
		}
	}
	// Retrying after a completed update is harmless and reuses the replacement.
	if err := UpdateModelRuntime(context.Background(), dir, "parakeet-tdt-0.6b-v3", func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
}

func TestNativeRuntimeUpdateFailurePreservesLegacy(t *testing.T) {
	for _, failure := range []string{"download", "checksum", "cannot start", "cancelled"} {
		t.Run(failure, func(t *testing.T) {
			dir, legacy, model := nativeUpdateFixture(t)
			archive := nativeUpdateArchive(t, []byte("invalid executable"))
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				switch failure {
				case "download":
					w.WriteHeader(http.StatusServiceUnavailable)
				case "checksum":
					bad := append([]byte{}, archive...)
					bad[len(bad)-1] ^= 1
					_, _ = w.Write(bad)
				default:
					_, _ = w.Write(archive)
				}
			}))
			defer server.Close()
			useNativeUpdateAsset(t, server.URL, archive)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if failure == "cancelled" {
				cancel()
			}
			err := UpdateModelRuntime(ctx, dir, "parakeet-tdt-0.6b-v3", func(int64, int64) {})
			if err == nil || (failure == "cancelled" && !errors.Is(err, context.Canceled)) {
				t.Fatalf("update did not report %s: %v", failure, err)
			}
			for _, path := range []string{model, filepath.Join(legacy, "keep.txt")} {
				if data, err := os.ReadFile(path); err != nil || string(data) != "keep" {
					t.Fatalf("failed update damaged %s: %q %v", path, data, err)
				}
			}
			if _, err := os.Stat(speech.RuntimePath(dir, "parakeet")); !os.IsNotExist(err) {
				t.Fatal("failed replacement was published", err)
			}
		})
	}
}

func TestNativeRuntimeUpdateRejectsRedirectedLegacy(t *testing.T) {
	dir, legacy, _ := nativeUpdateFixture(t)
	if err := os.Rename(legacy, legacy+"-original"); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	keep := filepath.Join(outside, "keep.txt")
	if err := os.WriteFile(keep, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, legacy); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := UpdateModelRuntime(context.Background(), dir, "parakeet-tdt-0.6b-v3", func(int64, int64) {}); err == nil {
		t.Fatal("accepted redirected legacy installation")
	}
	if data, err := os.ReadFile(keep); err != nil || string(data) != "outside" {
		t.Fatalf("changed redirected storage: %q %v", data, err)
	}
}

func TestNativeRuntimeUpdateCatalogState(t *testing.T) {
	dir, legacy, model := nativeUpdateFixture(t)
	previous := Catalog
	Catalog = []Model{{ID: "parakeet-tdt-0.6b-v3", Kind: "parakeet", Filename: filepath.Base(model), Size: 4, SHA: fmt.Sprintf("%x", sha256.Sum256([]byte("keep")))}}
	t.Cleanup(func() { Catalog = previous })
	list := List(dir)
	if len(list) != 1 || !list[0].Installed || !list[0].RuntimeUpdateAvailable {
		t.Fatal("installed model did not expose its outdated runtime", list)
	}
	if err := os.RemoveAll(legacy); err != nil {
		t.Fatal(err)
	}
	if List(dir)[0].RuntimeUpdateAvailable {
		t.Fatal("offered an update without an older managed runtime")
	}
}

func TestWhisperRuntimeUpdateCommitsSelectionBeforeCleanup(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("macOS uses bundled Whisper instead of managed runtime downloads")
	}
	for _, failSave := range []bool{false, true} {
		t.Run(fmt.Sprintf("saveFailure=%t", failSave), func(t *testing.T) {
			dir := t.TempDir()
			legacy := filepath.Join(dir, "runtime", "whisper-1.9.2")
			current := filepath.Join(dir, "runtime", "whisper-"+WhisperRuntimeVersion, whisperExecutableName())
			for _, folder := range []string{legacy, filepath.Dir(current)} {
				if err := os.MkdirAll(folder, 0700); err != nil {
					t.Fatal(err)
				}
			}
			self, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(self)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(current, data, 0700); err != nil {
				t.Fatal(err)
			}
			called := false
			saveFailure := errors.New("settings save failed")
			err = UpdateModelRuntimeWithSelection(context.Background(), dir, "tiny", func(int64, int64) {}, func(path string) error {
				called = true
				if path != current {
					t.Errorf("selected wrong replacement: %s", path)
				}
				if _, err := os.Stat(legacy); err != nil {
					t.Error("removed selected runtime before saving replacement", err)
				}
				if failSave {
					return saveFailure
				}
				return nil
			})
			if !called || (failSave && !errors.Is(err, saveFailure)) || (!failSave && err != nil) {
				t.Fatal("unexpected update outcome", called, err)
			}
			_, statErr := os.Stat(legacy)
			if failSave && statErr != nil {
				t.Fatal("failed save removed the selected runtime", statErr)
			}
			if !failSave && !os.IsNotExist(statErr) {
				t.Fatal("old runtime remains after selection was saved", statErr)
			}
		})
	}
}

func TestKnownRuntimeCleanupKeepsOtherEngines(t *testing.T) {
	for _, kind := range []string{"whisper", "moonshine", "text", "ffmpeg"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			for _, names := range supersededNativeRuntimes {
				for _, name := range names {
					if err := os.MkdirAll(filepath.Join(dir, "runtime", name), 0700); err != nil {
						t.Fatal(err)
					}
				}
			}
			if !RuntimeUpdateAvailable(dir, kind) {
				t.Fatal("old runtime not detected")
			}
			if err := RemoveSupersededRuntimes(context.Background(), dir, kind); err != nil {
				t.Fatal(err)
			}
			for other, names := range supersededNativeRuntimes {
				for _, name := range names {
					_, err := os.Stat(filepath.Join(dir, "runtime", name))
					if other == kind && !os.IsNotExist(err) {
						t.Errorf("did not remove %s: %v", name, err)
					}
					if other != kind && err != nil {
						t.Errorf("removed another engine's runtime %s: %v", name, err)
					}
				}
			}
		})
	}
}

func TestSpeechRuntimeUpdateCatalogSupportsWhisperAndMoonshine(t *testing.T) {
	previous := Catalog
	t.Cleanup(func() { Catalog = previous })
	for _, kind := range []string{"whisper", "moonshine"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			legacy := filepath.Join(dir, "runtime", supersededNativeRuntimes[kind][0])
			if err := os.MkdirAll(legacy, 0700); err != nil {
				t.Fatal(err)
			}
			m := Model{ID: "tiny", Filename: "fixture.bin", Size: 4, SHA: fmt.Sprintf("%x", sha256.Sum256([]byte("keep")))}
			if kind == "moonshine" {
				m = Model{ID: "moonshine-base", Kind: "moonshine", Arch: 1, Files: []ModelFile{{Name: "encoder.ort", Size: 4, SHA: m.SHA}}}
			}
			path := modelPath(dir, m)
			if kind == "moonshine" {
				if err := os.MkdirAll(path, 0700); err != nil {
					t.Fatal(err)
				}
				data, err := json.Marshal(speech.Bundle{Arch: 1, Files: []speech.BundleFile{{Name: "encoder.ort", Size: 4}}})
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(path, speech.BundleManifest), data, 0600); err != nil {
					t.Fatal(err)
				}
				path = filepath.Join(path, "encoder.ort")
			}
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			Catalog = []Model{m}
			list := List(dir)
			if len(list) != 1 || !list[0].Installed || !list[0].RuntimeUpdateAvailable {
				t.Fatal("installed speech model lost its runtime update action", list)
			}
		})
	}
}

func TestRuntimeReferencesResolvePATHAliases(t *testing.T) {
	dir := t.TempDir()
	legacy := filepath.Join(dir, "runtime", "whisper-1.9.2")
	if err := os.MkdirAll(legacy, 0700); err != nil {
		t.Fatal(err)
	}
	name := whisperExecutableName()
	path := filepath.Join(legacy, name)
	if err := os.WriteFile(path, []byte("executable fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", legacy)
	linked, err := ReferencesSupersededRuntime(dir, name, "whisper")
	if err != nil || !linked {
		t.Fatal("PATH alias into previous runtime was not detected", linked, err)
	}
	custom := filepath.Join(dir, name)
	if err := os.WriteFile(custom, []byte("custom fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	linked, err = ReferencesSupersededRuntime(dir, custom, "whisper")
	if err != nil || linked {
		t.Fatal("independent custom executable treated as an old managed runtime", linked, err)
	}
}
