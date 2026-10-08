package models

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yap/internal/audio"
	"yap/internal/process"
)

func ffmpegFixture(t *testing.T, extra string) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	names := append([]string{}, ffmpegRequired...)
	if extra != "" {
		names = append(names, extra)
	}
	for _, name := range names {
		if name == "COPYING.GPLv3" || name == "YAP-SOURCE-NOTICE.txt" {
			continue
		}
		f, err := w.Create(FFmpegPackage + "/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte("fixture " + name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestFFmpegVerifiedInstallAndFailurePreservesInstallation(t *testing.T) {
	for _, mode := range []string{"success", "checksum", "size", "http", "cancel", "traversal"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			root := filepath.Join(dir, "runtime")
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			old := filepath.Join(root, FFmpegPackage)
			os.Mkdir(old, 0700)
			os.WriteFile(filepath.Join(old, "previous"), []byte("keep on failure"), 0600)
			extra := ""
			if mode == "traversal" {
				extra = "../outside"
			}
			data := ffmpegFixture(t, extra)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if mode == "http" {
					w.WriteHeader(503)
					return
				}
				w.Write(data)
			}))
			defer server.Close()
			hash, size := fmt.Sprintf("%x", sha256.Sum256(data)), int64(len(data))
			if mode == "checksum" {
				hash = strings.Repeat("0", 64)
			}
			if mode == "size" {
				size++
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			progress := 0
			path, err := installFFmpeg(ctx, dir, server.URL, hash, size, func(n, total int64) {
				progress++
				if mode == "cancel" {
					cancel()
				}
			})
			if mode == "success" {
				if err != nil || path != ffmpegPathIn(old) || progress == 0 {
					t.Fatalf("install: %s %v", path, err)
				}
				for _, name := range []string{"LICENSE.txt", "COPYING.GPLv3", "YAP-SOURCE-NOTICE.txt"} {
					if data, err := os.ReadFile(filepath.Join(old, name)); err != nil || len(data) == 0 {
						t.Fatalf("missing notice %s: %v", name, err)
					}
				}
			} else {
				if err == nil {
					t.Fatal("accepted failed install")
				}
				if data, err := os.ReadFile(filepath.Join(old, "previous")); err != nil || string(data) != "keep on failure" {
					t.Fatal("previous install changed", err)
				}
			}
			entries, _ := os.ReadDir(root)
			if len(entries) != 1 || entries[0].Name() != FFmpegPackage {
				t.Fatalf("staging leaked: %v", entries)
			}
		})
	}
}

func TestFFmpegRejectsRedirectedRuntime(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "runtime")); err != nil {
		t.Skip(err)
	}
	if _, err := installFFmpeg(context.Background(), dir, "http://unused.invalid", "", 0, func(int64, int64) {}); err == nil {
		t.Fatal("accepted redirected runtime")
	}
	if files, _ := os.ReadDir(outside); len(files) != 0 {
		t.Fatal("wrote outside app data")
	}
}

// Explicit opt-in: validates the real pinned archive and private installation.
func TestFFmpegDownloadIntegration(t *testing.T) {
	if os.Getenv("YAP_FFMPEG_INTEGRATION") != "1" || !CanInstallFFmpeg() {
		t.Skip("set YAP_FFMPEG_INTEGRATION=1 on Windows x64")
	}
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "runtime"), 0700)
	path, err := InstallFFmpeg(context.Background(), dir, func(int64, int64) {})
	if err != nil || path == "" || FFmpegPath(dir) != path {
		t.Fatal(path, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	wav := filepath.Join(dir, "source.wav")
	f, err := os.Create(wav)
	if err != nil {
		t.Fatal(err)
	}
	if err = audio.Header(f, 32000); err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(make([]byte, 32000)); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	for _, format := range []struct{ ext, codec string }{
		{"mp3", "libmp3lame"}, {"m4a", "aac"}, {"aac", "aac"}, {"flac", "flac"},
		{"ogg", "libvorbis"}, {"opus", "libopus"}, {"aiff", "pcm_s16be"}, {"wma", "wmav2"},
	} {
		t.Run(format.ext, func(t *testing.T) {
			source := filepath.Join(dir, "source."+format.ext)
			cmd := exec.CommandContext(ctx, path, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", wav, "-c:a", format.codec, source)
			process.Hide(cmd)
			if log, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("fixture: %v %s", err, log)
			}
			out, err := os.CreateTemp(dir, "normalized-*.wav")
			if err != nil {
				t.Fatal(err)
			}
			defer out.Close()
			duration, err := audio.NormalizeImportWithFFmpeg(ctx, source, out, path)
			if err != nil || duration < 900 || duration > 1300 {
				t.Fatalf("decode: %d ms, %v", duration, err)
			}
		})
	}
}
