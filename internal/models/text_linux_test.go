//go:build linux

package models

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

func TestLinuxTextRuntimeInstallation(t *testing.T) {
	for _, tc := range []struct {
		name       string
		mode       int64
		dependency bool
		wantErr    bool
	}{
		{"executable and versioned libraries", 0755, true, false},
		{"missing dependency preserves installation", 0755, false, true},
		{"missing execute permission preserves installation", 0644, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			for _, backend := range []string{"cpu", "vulkan"} {
				root := filepath.Dir(TextRuntimePath(dir, backend))
				if err := os.MkdirAll(root, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(root, "previous"), []byte("old"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			var archive bytes.Buffer
			gz := gzip.NewWriter(&archive)
			w := tar.NewWriter(gz)
			write := func(h *tar.Header, data string) {
				t.Helper()
				if err := w.WriteHeader(h); err != nil {
					t.Fatal(err)
				}
				if _, err := w.Write([]byte(data)); err != nil {
					t.Fatal(err)
				}
			}
			script := "#!/bin/sh\ntest -s \"$(dirname \"$0\")/libllama.so.0\"\n"
			write(&tar.Header{Name: "llama-b12110/llama-server", Mode: tc.mode, Size: int64(len(script))}, script)
			if tc.dependency {
				write(&tar.Header{Name: "llama-b12110/libllama.so.0.9.0", Mode: 0644, Size: 7}, "library")
				write(&tar.Header{Name: "llama-b12110/libllama.so.0", Typeflag: tar.TypeSymlink, Linkname: "libllama.so.0.9.0"}, "")
				write(&tar.Header{Name: "llama-b12110/libllama.so", Typeflag: tar.TypeSymlink, Linkname: "libllama.so.0"}, "")
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}
			if err := gz.Close(); err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if r.URL.Path == "/crt" {
					t.Error("Linux requested the Windows C++ runtime")
					w.WriteHeader(http.StatusNotFound)
					return
				}
				w.Write(archive.Bytes())
			}))
			defer server.Close()
			originalCRT := textCRTAsset
			textCRTAsset.URL = server.URL + "/crt"
			defer func() { textCRTAsset = originalCRT }()
			for _, backend := range []string{"cpu", "vulkan"} {
				key := "linux/" + runtime.GOARCH + "/" + backend
				original, existed := textRuntimeAssets[key]
				textRuntimeAssets[key] = runtimeAsset{URL: server.URL + "/" + backend, SHA: fmt.Sprintf("%x", sha256.Sum256(archive.Bytes())), Size: int64(archive.Len()), Tar: true}
				defer func() {
					if existed {
						textRuntimeAssets[key] = original
					} else {
						delete(textRuntimeAssets, key)
					}
				}()
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			report := func(int64, int64) {}
			err := EnsureTextRuntime(ctx, dir, report)
			if tc.wantErr {
				if err == nil {
					t.Fatal("accepted an unusable text runtime")
				}
				for _, backend := range []string{"cpu", "vulkan"} {
					if data, err := os.ReadFile(filepath.Join(filepath.Dir(TextRuntimePath(dir, backend)), "previous")); err != nil || string(data) != "old" {
						t.Fatal("failed installation damaged previous runtime", backend, err)
					}
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, backend := range []string{"cpu", "vulkan"} {
				path := TextRuntimePath(dir, backend)
				st, err := os.Stat(path)
				if err != nil || filepath.Base(path) != "llama-server" || st.Mode()&0111 == 0 {
					t.Fatal("Linux executable was not installed", backend, err)
				}
				for _, name := range []string{"libllama.so", "libllama.so.0", "llama-LICENSE.txt", "gemma-LICENSE.txt"} {
					st, err := os.Lstat(filepath.Join(filepath.Dir(path), name))
					if err != nil || !st.Mode().IsRegular() || st.Size() == 0 {
						t.Fatal("library or license was not materialized", backend, name, err)
					}
				}
			}
			if err := EnsureTextRuntime(ctx, dir, report); err != nil || requests.Load() != 2 {
				t.Fatal("healthy runtimes were downloaded again", requests.Load(), err)
			}
			if err := os.Remove(filepath.Join(filepath.Dir(TextRuntimePath(dir, "cpu")), "libllama.so.0")); err != nil {
				t.Fatal(err)
			}
			if err := EnsureTextRuntime(ctx, dir, report); err != nil || requests.Load() != 3 {
				t.Fatal("missing dependency was not repaired", requests.Load(), err)
			}
		})
	}
}
