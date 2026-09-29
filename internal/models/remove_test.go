package models

import (
	"os"
	"path/filepath"
	"testing"
)

func TestModelDiskUsageAndManagedRemoval(t *testing.T) {
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "models"), 0700)
	path := filepath.Join(dir, "models", "ggml-tiny.bin")
	os.WriteFile(path, []byte("bad-model"), 0600)
	custom := filepath.Join(dir, "models", "custom.bin")
	os.WriteFile(custom, []byte("custom"), 0600)
	model := List(dir)[0]
	if model.DiskBytes != 9 || !model.Removable || model.Installed {
		t.Fatalf("corrupt managed file usage not reported: %+v", model)
	}
	if err := Remove(dir, "../custom", ""); err == nil {
		t.Fatal("unknown/path model accepted")
	}
	if err := Remove(dir, "tiny", path); err == nil {
		t.Fatal("active model removed")
	}
	alias := filepath.Join(dir, "active-alias.bin")
	if err := os.Link(path, alias); err != nil {
		t.Fatal(err)
	}
	if err := Remove(dir, "tiny", alias); err == nil {
		t.Fatal("active hard-linked model removed")
	}
	if err := Remove(dir, "tiny", custom); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(custom); err != nil {
		t.Fatal("custom model removed")
	}
	if List(dir)[0].DiskBytes != 0 || List(dir)[0].Removable {
		t.Fatal("removed file remains listed")
	}
	os.Mkdir(path, 0700)
	if err := Remove(dir, "tiny", ""); err == nil {
		t.Fatal("directory removed")
	}
}

func TestModelRemovalRejectsSymlinksAndRedirectedStorage(t *testing.T) {
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "models"), 0700)
	outside := filepath.Join(t.TempDir(), "ggml-tiny.bin")
	os.WriteFile(outside, []byte("keep"), 0600)
	path := filepath.Join(dir, "models", "ggml-tiny.bin")
	if err := os.Symlink(outside, path); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	if err := Remove(dir, "tiny", ""); err == nil {
		t.Fatal("symlink accepted")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("custom file removed")
	}
	os.Remove(path)
	os.Remove(filepath.Join(dir, "models"))
	if err := os.Symlink(filepath.Dir(outside), filepath.Join(dir, "models")); err != nil {
		t.Fatal(err)
	}
	if err := Remove(dir, "tiny", ""); err == nil {
		t.Fatal("redirected models directory accepted")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("external model removed")
	}
}
