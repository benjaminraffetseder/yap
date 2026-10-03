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
)

func TestDownloadIntegrityAndCleanup(t *testing.T) {
	content := []byte("a verified model")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(content) }))
	defer server.Close()
	hash := fmt.Sprintf("%x", sha256.Sum256(content))
	dir := t.TempDir()
	path := filepath.Join(dir, "model.bin")
	if err := Download(context.Background(), server.URL, path, hash, int64(len(content)), func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != string(content) {
		t.Fatal("model contents changed")
	}
	if err := Download(context.Background(), server.URL, path, "wrong", int64(len(content)), func(int64, int64) {}); err == nil {
		t.Fatal("accepted a checksum mismatch")
	}
	data, _ = os.ReadFile(path)
	if string(data) != string(content) {
		t.Fatal("failed download damaged installed model")
	}
	if err := Download(context.Background(), server.URL, path, hash, 3, func(int64, int64) {}); err == nil {
		t.Fatal("accepted oversized response")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Download(ctx, server.URL, path, hash, int64(len(content)), func(int64, int64) {}); err == nil {
		t.Fatal("ignored cancellation")
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 1 {
		t.Fatal("temporary files leaked")
	}
}

func TestFreshModelInstallRejectsRedirectedStorage(t *testing.T) {
	content := []byte("verified model")
	model := Model{ID: "test", Size: int64(len(content)), SHA: fmt.Sprintf("%x", sha256.Sum256(content))}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		_, _ = w.Write(content)
	}))
	defer server.Close()
	dir, outside := t.TempDir(), t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "models")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	_, err := installModel(context.Background(), dir, model, server.URL, func(int64, int64) {})
	if err == nil || requests.Load() != 0 {
		t.Errorf("redirected storage reached download: %v, requests %d", err, requests.Load())
	}
	if files, err := os.ReadDir(outside); err != nil || len(files) != 0 {
		t.Fatalf("changed external directory: %v %v", files, err)
	}
}
