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
