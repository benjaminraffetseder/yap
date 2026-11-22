package speech

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yap/internal/audio"
)

func TestSpeechWorkerHelper(t *testing.T) {
	if os.Getenv("YAP_FAKE_SPEECH") != "1" {
		return
	}
	count := 0
	err := serveNative(os.Stdin, os.Stdout, func(req speechRequest) (string, error) {
		count++
		switch req.Audio {
		case "crash":
			os.Exit(9)
		case "empty":
			return "", nil
		case "wait":
			if err := os.WriteFile(req.Prompt, []byte("ready"), 0600); err != nil {
				return "", err
			}
			time.Sleep(time.Hour)
		}
		return fmt.Sprintf("%d/%s/%s/%s", count, req.Audio, req.Language, req.Prompt), nil
	})
	if err != nil {
		os.Exit(5)
	}
	os.Exit(0)
}

func makeMoonshine(t *testing.T, dir, name string) Options {
	t.Helper()
	opts := Options{Model: filepath.Join(dir, "models", "moonshine-"+name), Language: "en"}
	for p, data := range map[string]string{RuntimeFor(opts): "runtime", filepath.Join(opts.Model, "weights"): "x", filepath.Join(opts.Model, BundleManifest): `{"arch":2,"files":[{"name":"weights","size":1}]}`} {
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return opts
}
func fakeManaged(t *testing.T) (*Managed, Options) {
	t.Helper()
	dir := t.TempDir()
	m := NewManaged(dir)
	t.Cleanup(m.Close)
	t.Setenv("YAP_FAKE_SPEECH", "1")
	m.start = func(ctx context.Context, path string, opts Options) (warmWorker, error) {
		return startNativeWorker(ctx, os.Args[0], []string{"-test.run=^TestSpeechWorkerHelper$"})
	}
	return m, makeMoonshine(t, dir, "tiny")
}

func TestManagedReusesWorkerAndInvalidatesFiles(t *testing.T) {
	m, opt := fakeManaged(t)
	verify := func(want int) {
		t.Helper()
		got, err := m.Transcribe(t.Context(), "audio", opt)
		expected := fmt.Sprintf("%d/audio/%s/%s", want, opt.Language, opt.Prompt)
		if err != nil || got != expected {
			t.Fatalf("got %q (%v), want %q", got, err, expected)
		}
	}
	opt.Prompt = "Yap"
	verify(1)
	opt.Prompt = ""
	opt.Language = "auto"
	verify(2)
	if _, err := m.Transcribe(t.Context(), "empty", opt); !errors.Is(err, ErrNoSpeech) {
		t.Fatal(err)
	}
	verify(4)
	for _, path := range []string{filepath.Join(opt.Model, "weights"), RuntimeFor(opt), filepath.Join(opt.Model, BundleManifest)} {
		now := time.Now().Add(time.Hour)
		if err := os.Chtimes(path, now, now); err != nil {
			t.Fatal(err)
		}
		verify(1)
	}
	opt = makeMoonshine(t, m.dir, "other")
	verify(1)
	m.Release()
	verify(1)
	if _, err := m.Transcribe(t.Context(), "crash", opt); err == nil {
		t.Fatal("crash accepted")
	}
	verify(1)
	m.Close()
	if _, err := m.Transcribe(t.Context(), "audio", opt); err == nil {
		t.Fatal("request accepted after shutdown")
	}
}

func TestManagedInterruptsBlockedRequest(t *testing.T) {
	for _, action := range []string{"cancel", "release", "close"} {
		t.Run(action, func(t *testing.T) {
			m, opt := fakeManaged(t)
			marker := filepath.Join(t.TempDir(), "ready")
			opt.Prompt = marker
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := m.Transcribe(ctx, "wait", opt); done <- err }()
			deadline := time.Now().Add(8 * time.Second)
			for {
				if _, err := os.Stat(marker); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("worker did not receive request")
				}
				time.Sleep(10 * time.Millisecond)
			}
			queued, stop := context.WithTimeout(t.Context(), 20*time.Millisecond)
			_, err := m.Transcribe(queued, "queued", opt)
			stop()
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("queued request: %v", err)
			}
			switch action {
			case "cancel":
				cancel()
			case "release":
				m.Release()
			case "close":
				m.Close()
			}
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("interruption: %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("interruption timed out")
			}
			if action != "close" {
				got, err := m.Transcribe(t.Context(), "fresh", opt)
				if err != nil || !strings.HasPrefix(got, "1/fresh/") {
					t.Fatal(got, err)
				}
			}
		})
	}
}

func TestWorkerKeyDetectsSameSizeReplacement(t *testing.T) {
	dir := t.TempDir()
	opts := makeMoonshine(t, dir, "tiny")
	files, err := workerFiles(RuntimeFor(opts), opts)
	if err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(opts.Model, "weights")
	st, err := os.Stat(dest)
	if err != nil {
		t.Fatal(err)
	}
	replacement := filepath.Join(dir, "replacement")
	if err = os.WriteFile(replacement, []byte("z"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(replacement, st.ModTime(), st.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(replacement, dest); err != nil {
		t.Fatal(err)
	}
	// Restore the enclosing directory timestamp too.
	if err = os.Chtimes(opts.Model, files[0].info.ModTime(), files[0].info.ModTime()); err != nil {
		t.Fatal(err)
	}
	next, err := workerFiles(RuntimeFor(opts), opts)
	if err != nil {
		t.Fatal(err)
	}
	if sameFiles(files, next) {
		t.Fatal("accepted replaced weights")
	}
}

func TestManagedIdleReapsWorker(t *testing.T) {
	m, opt := fakeManaged(t)
	m.idleTimeout = 30 * time.Millisecond
	if _, err := m.Transcribe(t.Context(), "audio", opt); err != nil {
		t.Fatal(err)
	}
	m.gate <- struct{}{}
	w := m.worker.(*nativeWorker)
	<-m.gate
	select {
	case <-w.done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker stayed alive")
	}
	got, err := m.Transcribe(t.Context(), "fresh", opt)
	if err != nil || !strings.HasPrefix(got, "1/fresh") {
		t.Fatal(got, err)
	}
}

func TestOversizedNativeFrame(t *testing.T) {
	if err := readFrame(bytes.NewReader([]byte{255, 255, 255, 255}), &speechRequest{}, maxRequest); err == nil {
		t.Fatal("oversized header accepted")
	}
}

func TestManagedPreservesCustomWhisperCLI(t *testing.T) {
	m := NewManaged(t.TempDir())
	defer m.Close()
	opts := testOptions(t)
	opts.Prompt = "several words, two terms"
	t.Setenv("YAP_TEST_WHISPER", "prompt")
	t.Setenv("YAP_EXPECT_PROMPT", opts.Prompt)
	got, err := m.Transcribe(t.Context(), "custom CLI audio.wav", opts)
	if err != nil || got != "Hello, local world." || m.worker != nil {
		t.Fatal(got, err)
	}
}

func TestInstalledWarmSpeech(t *testing.T) {
	// Opt-in only. Every path refers to existing, local data. Default input is
	// synthetic silence; verify model lifetime even when silence has no tokens.
	model := os.Getenv("YAP_WARM_MODEL")
	if model == "" {
		t.Skip("set YAP_WARM_MODEL to an installed speech model")
	}
	dir := os.Getenv("YAP_WARM_DIR")
	opts := Options{Model: model, Executable: os.Getenv("YAP_WARM_WHISPER"), Language: "en"}
	m := NewManaged(dir)
	defer m.Close()
	if m.runtime(opts) == "" {
		t.Fatal("selected model has no managed worker")
	}
	path := os.Getenv("YAP_WARM_TEST_WAV")
	if path == "" {
		var wav bytes.Buffer
		if err := audio.Header(&wav, 64000); err != nil {
			t.Fatal(err)
		}
		wav.Write(make([]byte, 64000))
		path = filepath.Join(t.TempDir(), "silence.wav")
		if err := os.WriteFile(path, wav.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Minute)
	defer cancel()
	var first warmWorker
	for i, prompt := range []string{"country", ""} {
		opts.Prompt = prompt
		text, err := m.Transcribe(ctx, path, opts)
		if err != nil && !errors.Is(err, ErrNoSpeech) {
			t.Fatal(err)
		}
		if want := os.Getenv("YAP_WARM_EXPECT"); want != "" && !strings.Contains(strings.ToLower(text), strings.ToLower(want)) {
			t.Fatal("expected phrase absent")
		}
		if i == 0 {
			first = m.worker
		} else if first == nil || first != m.worker {
			t.Fatal("model reloaded")
		}
	}
}
