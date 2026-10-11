package models

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestBundleInstallRepairIntegrityAndRemoval(t *testing.T) {
	contents := map[string]string{"encoder.ort": "encoder weights", "decoder.ort": "decoder weights"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, contents[filepath.Base(r.URL.Path)]) }))
	defer server.Close()
	m := Model{ID: "moonshine-test", Kind: "moonshine", Arch: 2}
	for _, name := range []string{"encoder.ort", "decoder.ort"} {
		body := []byte(contents[name])
		sha := fmt.Sprintf("%x", sha256.Sum256(body))
		if name == "encoder.ort" {
			h, digest := newDigest("crc32c:")
			h.Write(body)
			sha = digest()
		}
		m.Files = append(m.Files, ModelFile{Name: name, URL: server.URL + "/" + name, Size: int64(len(body)), SHA: sha})
		m.Size += int64(len(body))
	}
	oldCatalog := Catalog
	Catalog = []Model{m}
	t.Cleanup(func() { Catalog = oldCatalog })
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "models"), 0700); err != nil {
		t.Fatal(err)
	}
	report := func(int64, int64) {}
	path, err := Install(context.Background(), dir, m.ID, report)
	if err != nil {
		t.Fatal(err)
	}
	if got := List(dir)[0]; !got.Installed || !got.Removable || got.DiskBytes < m.Size || got.Path != path {
		t.Fatalf("bad installed bundle: %+v", got)
	}
	if err := Remove(dir, m.ID, path); err == nil {
		t.Fatal("removed active folder")
	}
	if err := Remove(dir, m.ID, filepath.Join(path, "encoder.ort")); err == nil {
		t.Fatal("removed active file inside folder")
	}
	// A corrupt replacement cannot publish any of its verified earlier files.
	if err := os.WriteFile(filepath.Join(path, "decoder.ort"), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	contents["decoder.ort"] = "invalid weights"
	if _, err := Install(context.Background(), dir, m.ID, report); err == nil {
		t.Fatal("accepted corrupt download")
	}
	data, _ := os.ReadFile(filepath.Join(path, "decoder.ort"))
	if string(data) != "partial" {
		t.Fatal("failed repair replaced previous model")
	}
	if got := List(dir)[0]; got.Installed || !got.Removable {
		t.Fatalf("incomplete bundle not repairable: %+v", got)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatal("staging folder leaked", entries)
	}
	contents["decoder.ort"] = "decoder weights"
	ctx, cancel := context.WithCancel(context.Background())
	if _, err := Install(ctx, dir, m.ID, func(n, total int64) {
		if n >= m.Files[0].Size {
			cancel()
		}
	}); err == nil {
		t.Fatal("ignored cancelled bundle download")
	}
	data, _ = os.ReadFile(filepath.Join(path, "decoder.ort"))
	if string(data) != "partial" {
		t.Fatal("cancelled repair replaced previous model")
	}
	if _, err := Install(context.Background(), dir, m.ID, report); err != nil {
		t.Fatal(err)
	}
	if !List(dir)[0].Installed {
		t.Fatal("repair did not restore installed state")
	}
	if err := Remove(dir, m.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("model folder remains")
	}
}

func TestNativeCatalogPathsAndCancellation(t *testing.T) {
	dir := t.TempDir()
	for _, m := range Catalog {
		if m.Kind == "" {
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		path, err := Install(ctx, dir, m.ID, func(int64, int64) {})
		if err != context.Canceled || path != modelPath(dir, m) {
			t.Fatalf("model %s not accepted: %s %v", m.ID, path, err)
		}
		if m.Kind == "moonshine" {
			var size int64
			for _, f := range m.Files {
				size += f.Size
				if f.SHA == "" || f.URL == "" {
					t.Fatal("unverified asset", f)
				}
			}
			if size != m.Size {
				t.Fatalf("wrong download size for %s", m.ID)
			}
		}
	}
}

func TestBundleRejectsRedirectedFiles(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	root := filepath.Join(dir, "models")
	path := filepath.Join(root, "moonshine-test")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(path, "redirected")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := safeBundle(dir, path); err == nil {
		t.Fatal("accepted redirected bundle")
	}
}
