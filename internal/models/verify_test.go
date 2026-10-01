package models

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestExactSizeCorruptionIsDetectedAndRepairIsAtomic(t *testing.T) {
	valid := []byte("verified")
	model := Model{ID: "test", Name: "Test", Size: int64(len(valid)), SHA: fmt.Sprintf("%x", sha256.Sum256(valid))}
	old := Catalog
	Catalog = []Model{model}
	defer func() { Catalog = old }()
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "models"), 0700)
	path := filepath.Join(dir, "models", "ggml-test.bin")
	os.WriteFile(path, []byte("damaged!"), 0600)
	listed := List(dir)[0]
	if listed.Installed || !listed.Removable || listed.Path != path {
		t.Fatalf("corruption hidden: %+v", listed)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Install(ctx, dir, "test", func(int64, int64) {}); err == nil {
		t.Fatal("reused corrupt file / ignored cancellation")
	}
	var content atomic.Value
	content.Store([]byte("bad-data"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(content.Load().([]byte)) }))
	defer server.Close()
	if _, err := installModel(context.Background(), dir, model, server.URL, func(int64, int64) {}); err == nil {
		t.Fatal("accepted corrupt replacement")
	}
	if got, _ := os.ReadFile(path); string(got) != "damaged!" {
		t.Fatal("failed repair changed original file")
	}
	content.Store(valid)
	if _, err := installModel(context.Background(), dir, model, server.URL, func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	if !List(dir)[0].Installed {
		t.Fatal("repaired model not usable")
	}
	// Reuse a verified file without reaching any server, then detect same-size edits.
	if _, err := installModel(context.Background(), dir, model, "http://127.0.0.1:1", func(int64, int64) {}); err != nil {
		t.Fatal("verified model not reused", err)
	}
	os.WriteFile(path, []byte("damaged!"), 0600)
	changed := time.Now().Add(time.Second)
	os.Chtimes(path, changed, changed)
	if List(dir)[0].Installed {
		t.Fatal("verification cache ignored an edit")
	}
	files, _ := os.ReadDir(filepath.Dir(path))
	if len(files) != 1 {
		t.Fatal("download files leaked")
	}
}
