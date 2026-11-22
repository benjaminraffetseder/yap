package speech

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeWhisperFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), 0700); err != nil {
		t.Fatal(err)
	}
}

func fixtureWhisperPair() whisperPair {
	return whisperPair{"Release/whisper-cli", "Release/whisper-server",
		fmt.Sprintf("%x", sha256.Sum256([]byte("cli"))),
		fmt.Sprintf("%x", sha256.Sum256([]byte("server")))}
}

func verifiedFixtureServer(dir, selected string, pair whisperPair) string {
	server := pair.serverPath(dir, selected)
	if server != "" && pair.matchesDigests(selected, server) {
		return server
	}
	return ""
}

func TestWhisperServerRequiresVerifiedPair(t *testing.T) {
	pair := fixtureWhisperPair()
	dir := t.TempDir()
	for _, folder := range []string{"whisper-" + WhisperRuntimeVersion, "whisper-1.9.2", "custom"} {
		root := filepath.Join(dir, "runtime", folder)
		for _, subdir := range []string{"", "other"} {
			cli, server := filepath.Join(root, subdir, pair.cli), filepath.Join(root, subdir, pair.server)
			writeWhisperFile(t, cli, "cli")
			if got := verifiedFixtureServer(dir, cli, pair); got != "" {
				t.Fatalf("accepted missing sibling at %s", got)
			}
			writeWhisperFile(t, server, "server")
			expected := ""
			if folder == "whisper-"+WhisperRuntimeVersion && subdir == "" {
				expected = server
			}
			if got := verifiedFixtureServer(dir, cli, pair); got != expected {
				t.Fatalf("got %q, want %q", got, expected)
			}
		}
	}
}

func TestWhisperVerificationDetectsReplacements(t *testing.T) {
	pair := fixtureWhisperPair()
	for _, replaced := range []string{pair.cli, pair.server} {
		t.Run(filepath.Base(replaced), func(t *testing.T) {
			dir := t.TempDir()
			root := filepath.Join(dir, "runtime", "whisper-"+WhisperRuntimeVersion)
			cli, server := filepath.Join(root, pair.cli), filepath.Join(root, pair.server)
			writeWhisperFile(t, cli, "cli")
			writeWhisperFile(t, server, "server")
			for i := 0; i < 2; i++ {
				if got := verifiedFixtureServer(dir, cli, pair); got != server {
					t.Fatal("verified pair rejected")
				}
			}
			path := filepath.Join(root, replaced)
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			writeWhisperFile(t, path+".new", strings.Repeat("x", int(info.Size())))
			if err := os.Chtimes(path+".new", info.ModTime(), info.ModTime()); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(path+".new", path); err != nil {
				t.Fatal(err)
			}
			if got := verifiedFixtureServer(dir, cli, pair); got != "" {
				t.Fatalf("accepted replacement at %s", got)
			}
		})
	}
}

func TestWhisperVerificationRejectsRedirectedDirectory(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	pair := fixtureWhisperPair()
	root := filepath.Join(dir, "runtime", "whisper-"+WhisperRuntimeVersion)
	writeWhisperFile(t, filepath.Join(outside, filepath.Base(pair.cli)), "cli")
	writeWhisperFile(t, filepath.Join(outside, filepath.Base(pair.server)), "server")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "Release")); err != nil {
		t.Skipf("cannot create test symlink: %v", err)
	}
	if got := verifiedFixtureServer(dir, filepath.Join(root, pair.cli), pair); got != "" {
		t.Fatalf("accepted redirected pair at %s", got)
	}
}

func TestUnverifiedWhisperSiblingUsesSelectedCLI(t *testing.T) {
	pair, ok := pinnedWhisperPair(runtime.GOOS + "/" + runtime.GOARCH)
	if !ok {
		t.Skip("no pinned server on this platform")
	}
	dir := t.TempDir()
	root := filepath.Join(dir, "runtime", "whisper-"+WhisperRuntimeVersion)
	opts := testOptions(t)
	testExe, err := os.ReadFile(opts.Executable)
	if err != nil {
		t.Fatal(err)
	}
	opts.Executable = filepath.Join(root, pair.cli)
	writeWhisperFile(t, filepath.Join(root, pair.server), "unverified sibling")
	if err := os.WriteFile(opts.Executable, testExe, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YAP_TEST_WHISPER", "success")
	m := NewManaged(dir)
	defer m.Close()
	got, err := m.Transcribe(t.Context(), "test.wav", opts)
	if err != nil || got != "Hello, local world." || m.worker != nil {
		t.Fatalf("expected CLI transcript, got %q, %v", got, err)
	}
}

func TestManagedWhisperRechecksPairAfterWorkerExit(t *testing.T) {
	m, _ := fakeManaged(t)
	opts := testOptions(t)
	exe, err := os.ReadFile(opts.Executable)
	if err != nil {
		t.Fatal(err)
	}
	pair := fixtureWhisperPair()
	if runtime.GOOS == "windows" {
		pair.cli += ".exe"
		pair.server += ".exe"
	}
	pair.cliSHA = fmt.Sprintf("%x", sha256.Sum256(exe))
	m.whisperPair = pair
	root := filepath.Join(m.dir, "runtime", "whisper-"+WhisperRuntimeVersion)
	server := filepath.Join(root, pair.server)
	writeWhisperFile(t, server, "server")
	opts.Executable = filepath.Join(root, pair.cli)
	if err := os.WriteFile(opts.Executable, exe, 0700); err != nil {
		t.Fatal(err)
	}

	startWorker := m.start
	starts := 0
	m.start = func(ctx context.Context, path string, opts Options) (warmWorker, error) {
		starts++
		if path != server || starts != 1 {
			t.Fatalf("unexpected worker launch %d at %s", starts, path)
		}
		return startWorker(ctx, path, opts)
	}
	for _, want := range []string{"1/audio/auto/", "2/audio/auto/"} {
		if got, err := m.Transcribe(t.Context(), "audio", opts); err != nil || got != want {
			t.Fatalf("got %q (%v), want %q", got, err, want)
		}
	}
	// Exit the helper without clearing Managed's previous worker or file key.
	m.gate <- struct{}{}
	m.worker.close()
	before := m.files
	<-m.gate
	info, err := os.Stat(server)
	if err != nil {
		t.Fatal(err)
	}
	writeWhisperFile(t, server, "broken")
	if err := os.Chtimes(server, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	after, err := workerFiles(server, opts)
	if err != nil || !sameFiles(before, after) {
		t.Fatalf("in-place rewrite changed the worker metadata key: %v", err)
	}
	t.Setenv("YAP_TEST_WHISPER", "success")
	got, err := m.Transcribe(t.Context(), "audio", opts)
	if err != nil || got != "Hello, local world." || m.worker != nil || starts != 1 {
		t.Fatalf("expected selected CLI after worker exit, got %q (%v), starts %d", got, err, starts)
	}
}

func TestWhisperVerifiesPeerBeforeUpload(t *testing.T) {
	w := whisperServer{addr: "127.0.0.1:8345", prefix: "/private", inference: "/second-secret"}
	for _, expected := range []bool{true, false} {
		body := "generic page"
		if expected {
			body = `<form action="/private/second-secret">`
		}
		var request bytes.Buffer
		conn := struct {
			io.Reader
			io.Writer
		}{strings.NewReader(fmt.Sprintf("HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n%s", len(body), body)), &request}
		err := w.verify(conn)
		if (err == nil) != expected {
			t.Fatal(err)
		}
		if strings.Contains(request.String(), w.inference) || !strings.HasPrefix(request.String(), "GET /private/ ") {
			t.Fatal("probe disclosed upload path")
		}
	}
}
func TestWhisperRejectsTruncatedAndOversizedResponses(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "http://localhost", nil)
	for _, tc := range []struct {
		size, limit int
		data        string
	}{{5, 200, "abc"}, {100, 80, strings.Repeat("x", 100)}} {
		raw := fmt.Sprintf("HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n%s", tc.size, tc.data)
		if _, err := readServerResponse(strings.NewReader(raw), req, int64(tc.limit)); err == nil {
			t.Fatal("invalid response accepted")
		}
	}
}
