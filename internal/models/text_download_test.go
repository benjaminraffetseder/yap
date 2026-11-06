package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

type repeatedByte byte

func (b repeatedByte) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte(b)
	}
	return len(p), nil
}

func TestTextDownloadResumesChunksAndVerifiesBeforePublication(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "models"), 0700)
	size := textChunkSize + 1024
	h := sha256.New()
	io.CopyN(h, repeatedByte('x'), size)
	var fail atomic.Bool
	fail.Store(true)
	var firstRequests atomic.Int32
	firstSaved := make(chan struct{})
	var saved sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var start, end int64
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		if start == 0 {
			firstRequests.Add(1)
		}
		if start != 0 && fail.Load() {
			<-firstSaved
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		w.WriteHeader(206)
		io.CopyN(w, repeatedByte('x'), end-start+1)
	}))
	defer server.Close()
	m := TextModel{ID: "test", Filename: "test.gguf", URL: server.URL, SHA: hex.EncodeToString(h.Sum(nil)), Size: size}
	progress := func(n, total int64) {
		if n >= textChunkSize {
			saved.Do(func() { close(firstSaved) })
		}
	}
	if err := downloadTextModel(context.Background(), dir, m, progress); err == nil {
		t.Fatal("accepted failed chunk")
	}
	if _, err := os.Stat(filepath.Join(dir, "models", m.Filename)); !os.IsNotExist(err) {
		t.Fatal("published an incomplete model")
	}
	fail.Store(false)
	if err := downloadTextModel(context.Background(), dir, m, progress); err != nil {
		t.Fatal(err)
	}
	if firstRequests.Load() != 1 {
		t.Fatal("downloaded a completed chunk again")
	}
	if st, err := os.Stat(filepath.Join(dir, "models", m.Filename)); err != nil || st.Size() != size {
		t.Fatal("missing verified model", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "models", ".text-download-test")); !os.IsNotExist(err) {
		t.Fatal("kept chunks after successful publication")
	}
}

func TestTextDownloadRejectsWrongRangesAndChecksums(t *testing.T) {
	for _, wrongRange := range []bool{true, false} {
		t.Run(fmt.Sprint(wrongRange), func(t *testing.T) {
			dir := t.TempDir()
			os.MkdirAll(filepath.Join(dir, "models"), 0700)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				value := "bytes 0-3/4"
				if wrongRange {
					value = "bytes 1-4/4"
				}
				w.Header().Set("Content-Range", value)
				w.WriteHeader(206)
				io.WriteString(w, "bad!")
			}))
			defer server.Close()
			h := sha256.Sum256([]byte("GGUF"))
			m := TextModel{ID: "test", Filename: "test.gguf", Size: 4, SHA: hex.EncodeToString(h[:]), URL: server.URL}
			if err := downloadTextModel(context.Background(), dir, m, func(int64, int64) {}); err == nil {
				t.Fatal("accepted corrupt download")
			}
			if _, err := os.Stat(filepath.Join(dir, "models", m.Filename)); !os.IsNotExist(err) {
				t.Fatal("published corrupt download")
			}
		})
	}
}

func TestTextRuntimeDownloadIntegration(t *testing.T) {
	if os.Getenv("YAP_TEXT_RUNTIME_INTEGRATION") != "1" {
		t.Skip("set YAP_TEXT_RUNTIME_INTEGRATION=1 to download and validate app-local Windows runtimes")
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "runtime"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := EnsureTextRuntime(context.Background(), dir, func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	for _, backend := range []string{"cpu", "vulkan"} {
		path := TextRuntimePath(dir, backend)
		if !textRuntimeHasCRT(path) {
			t.Fatal("runtime depends on a system-wide C++ redistributable", backend)
		}
		if err := checkNativeRuntime(context.Background(), path, "text"); err != nil {
			t.Fatal(err)
		}
	}
}
