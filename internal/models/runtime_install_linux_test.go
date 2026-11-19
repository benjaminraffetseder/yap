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
)

func TestLinuxWhisperManagedInstallation(t *testing.T) {
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
			dir, dest, _ := runtimeFixture(t, nil)
			var archive bytes.Buffer
			gz := gzip.NewWriter(&archive)
			w := tar.NewWriter(gz)
			script := "#!/bin/sh\ntest -s \"$(dirname \"$0\")/libwhisper.so.1\"\n"
			write := func(h *tar.Header, data string) {
				t.Helper()
				if err := w.WriteHeader(h); err != nil {
					t.Fatal(err)
				}
				if _, err := w.Write([]byte(data)); err != nil {
					t.Fatal(err)
				}
			}
			write(&tar.Header{Name: "bundle/whisper-cli", Mode: tc.mode, Size: int64(len(script))}, script)
			if tc.dependency {
				write(&tar.Header{Name: "bundle/libwhisper.so.1.9.2", Mode: 0644, Size: 7}, "library")
				write(&tar.Header{Name: "bundle/libwhisper.so.1", Typeflag: tar.TypeSymlink, Linkname: "libwhisper.so.1.9.2"}, "")
				write(&tar.Header{Name: "bundle/libwhisper.so", Typeflag: tar.TypeSymlink, Linkname: "libwhisper.so.1"}, "")
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}
			if err := gz.Close(); err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int64
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Write(archive.Bytes())
			}))
			defer server.Close()
			key := "linux/" + runtime.GOARCH
			original, existed := whisperRuntimes[key]
			whisperRuntimes[key] = runtimeAsset{server.URL, fmt.Sprintf("%x", sha256.Sum256(archive.Bytes())), int64(archive.Len()), true}
			defer func() {
				if existed {
					whisperRuntimes[key] = original
				} else {
					delete(whisperRuntimes, key)
				}
			}()
			report := func(int64, int64) {}
			path, err := InstallRuntime(context.Background(), dir, report)
			if tc.wantErr {
				if err == nil {
					t.Fatal("accepted unusable runtime")
				}
				if data, err := os.ReadFile(filepath.Join(dest, "remaining-library.dll")); err != nil || string(data) != "old" {
					t.Fatal("failed installation damaged previous runtime", err)
				}
				return
			}
			if err != nil || path != filepath.Join(dest, "whisper-cli") {
				t.Fatal("runtime was not installed", path, err)
			}
			for _, name := range []string{"libwhisper.so", "libwhisper.so.1"} {
				st, err := os.Lstat(filepath.Join(dest, name))
				if err != nil || !st.Mode().IsRegular() {
					t.Fatal("library chain was not materialized", name, err)
				}
			}
			if _, err := InstallRuntime(context.Background(), dir, report); err != nil || requests.Load() != 1 {
				t.Fatal("healthy runtime was downloaded again", requests.Load(), err)
			}
			if err := os.Remove(filepath.Join(dest, "libwhisper.so.1")); err != nil {
				t.Fatal(err)
			}
			if _, err := EnsureRuntime(context.Background(), dir, path, report); err != nil || requests.Load() != 2 {
				t.Fatal("missing library was not repaired", requests.Load(), err)
			}
		})
	}
}
