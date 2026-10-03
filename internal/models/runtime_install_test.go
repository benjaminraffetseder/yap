package models

import (
	"archive/zip"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type runtimeTransport func(*http.Request) (*http.Response, error)

func (f runtimeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRuntimeInstallRejectsRedirectedStorageBeforeDownload(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("automatic runtime installation is Windows x64 only")
	}
	for _, installed := range []bool{false, true} {
		t.Run(map[bool]string{false: "fresh", true: "installed"}[installed], func(t *testing.T) {
			dir, outside := t.TempDir(), t.TempDir()
			if err := os.Symlink(outside, filepath.Join(dir, "runtime")); err != nil {
				t.Skipf("symlinks unavailable: %v", err)
			}
			archive := filepath.Join(outside, "whisper.zip")
			if err := os.WriteFile(archive, []byte("external archive"), 0600); err != nil {
				t.Fatal(err)
			}
			if installed {
				root := filepath.Join(outside, "whisper-1.9.2")
				if err := os.Mkdir(root, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(root, "whisper-cli.exe"), []byte("external executable"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			requests := 0
			old := http.DefaultTransport
			http.DefaultTransport = runtimeTransport(func(*http.Request) (*http.Response, error) {
				requests++
				return nil, errors.New("unexpected remote request")
			})
			defer func() { http.DefaultTransport = old }()
			if _, err := InstallRuntime(context.Background(), dir, func(int64, int64) {}); err == nil || requests != 0 {
				t.Errorf("redirected runtime accepted or downloaded: %v, requests %d", err, requests)
			}
			if got, err := os.ReadFile(archive); err != nil || string(got) != "external archive" {
				t.Fatalf("external archive changed: %q %v", got, err)
			}
		})
	}
}

func runtimeFixture(t *testing.T, files map[string]string) (string, string, string) {
	t.Helper()
	dir := t.TempDir()
	runtimeDir := filepath.Join(dir, "runtime")
	if err := os.Mkdir(runtimeDir, 0700); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(runtimeDir, "whisper-1.9.2")
	if err := os.Mkdir(dest, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dest, "remaining-library.dll"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(dir, "runtime.zip")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	for name, content := range files {
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	return dir, dest, archive
}

func TestRuntimeRepairReplacesIncompleteInstallation(t *testing.T) {
	dir, dest, archive := runtimeFixture(t, map[string]string{"bin/whisper-cli.exe": "new executable", "bin/whisper.dll": "new library"})
	if RuntimePath(dir) != "" {
		t.Fatal("fixture is not incomplete")
	}
	path, err := installRuntimeArchive(context.Background(), dir, archive)
	if err != nil {
		t.Fatalf("repair failed: %v", err)
	}
	if path != filepath.Join(dest, "bin", "whisper-cli.exe") {
		t.Fatalf("wrong executable: %s", path)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "new executable" {
		t.Fatalf("replacement not installed: %q %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(dest, "remaining-library.dll")); !os.IsNotExist(err) {
		t.Fatal("incomplete runtime was not replaced")
	}
	entries, err := os.ReadDir(filepath.Join(dir, "runtime"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("staging files leaked: %v %v", entries, err)
	}
}

func TestInvalidRuntimeArchivePreservesInstallation(t *testing.T) {
	for _, files := range []map[string]string{{"library.dll": "no executable"}, {"whisper-cli.exe": ""}, {"../whisper-cli.exe": "escape"}} {
		t.Run("invalid", func(t *testing.T) {
			dir, dest, archive := runtimeFixture(t, files)
			if _, err := installRuntimeArchive(context.Background(), dir, archive); err == nil {
				t.Fatal("accepted invalid runtime")
			}
			if got, err := os.ReadFile(filepath.Join(dest, "remaining-library.dll")); err != nil || string(got) != "old" {
				t.Fatalf("previous runtime damaged: %q %v", got, err)
			}
		})
	}
}

func TestRuntimePublicationFailureRestoresPreviousDirectory(t *testing.T) {
	dir, dest, _ := runtimeFixture(t, map[string]string{})
	temp, err := os.MkdirTemp(filepath.Join(dir, "runtime"), ".extract-")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(temp, "whisper-cli.exe"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("replacement is locked")
	err = publishRuntimeDirectory(context.Background(), dir, temp, func(from, to string) error {
		if samePath(from, temp) {
			return failure
		}
		return os.Rename(from, to)
	})
	if !errors.Is(err, failure) {
		t.Fatalf("wrong error: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(dest, "remaining-library.dll")); err != nil || string(got) != "old" {
		t.Fatalf("rollback damaged runtime: %q %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(temp, "whisper-cli.exe")); err != nil {
		t.Fatalf("replacement not preserved: %v", err)
	}
}

func TestRuntimeCancellationRestoresStagedInstallation(t *testing.T) {
	dir, dest, _ := runtimeFixture(t, map[string]string{})
	temp, err := os.MkdirTemp(filepath.Join(dir, "runtime"), ".extract-")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err = publishRuntimeDirectory(ctx, dir, temp, func(from, to string) error {
		err := os.Rename(from, to)
		if samePath(from, dest) && err == nil {
			cancel()
		}
		return err
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("ignored cancellation: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(dest, "remaining-library.dll")); err != nil || string(got) != "old" {
		t.Fatalf("cancel damaged runtime: %q %v", got, err)
	}
}

func TestRuntimeRepairRejectsRedirectedStorage(t *testing.T) {
	for _, redirectRoot := range []bool{false, true} {
		t.Run(map[bool]string{false: "installation", true: "storage"}[redirectRoot], func(t *testing.T) {
			dir, dest, archive := runtimeFixture(t, map[string]string{"whisper-cli.exe": "new"})
			outside := t.TempDir()
			if err := os.WriteFile(filepath.Join(outside, "keep.txt"), []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			if redirectRoot {
				dest = filepath.Join(dir, "runtime")
			}
			if err := os.Rename(dest, dest+"-original"); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, dest); err != nil {
				t.Skipf("symlinks unavailable: %v", err)
			}
			if _, err := installRuntimeArchive(context.Background(), dir, archive); err == nil {
				t.Fatal("replaced redirected runtime")
			}
			if got, err := os.ReadFile(filepath.Join(outside, "keep.txt")); err != nil || string(got) != "keep" {
				t.Fatalf("changed external directory: %q %v", got, err)
			}
			if entries, err := os.ReadDir(outside); err != nil || len(entries) != 1 {
				t.Fatalf("wrote to external directory: %v %v", entries, err)
			}
		})
	}
}

func TestRuntimeArchiveCanCreateFreshInstallation(t *testing.T) {
	dir, dest, archive := runtimeFixture(t, map[string]string{"whisper-cli.exe": "fresh"})
	if err := os.Rename(dest, filepath.Join(dir, "old-fixture")); err != nil {
		t.Fatal(err)
	}
	path, err := installRuntimeArchive(context.Background(), dir, archive)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(dest, "whisper-cli.exe") {
		t.Fatalf("wrong executable: %s", path)
	}
}
