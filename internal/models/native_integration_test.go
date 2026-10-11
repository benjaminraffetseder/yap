package models_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yap/internal/inference/speech"
	"yap/internal/models"
)

func TestMain(m *testing.M) {
	if handled, err := speech.RunWorker(os.Args[1:]); handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestRealNativeModels(t *testing.T) {
	if os.Getenv("YAP_NATIVE_INTEGRATION") != "1" {
		t.Skip("set YAP_NATIVE_INTEGRATION=1 to download and transcribe with native models")
	}
	dir := os.Getenv("YAP_NATIVE_INTEGRATION_DIR")
	if dir == "" {
		dir = t.TempDir()
	}
	for _, folder := range []string{"models", "runtime"} {
		if err := os.MkdirAll(filepath.Join(dir, folder), 0700); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.2/samples/jfk.wav", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal(resp.Status)
	}
	path := filepath.Join(dir, "sample.wav")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = io.Copy(f, resp.Body)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"moonshine-v2-tiny", "moonshine-v2-small", "moonshine-v2-medium", "moonshine-base", "parakeet-tdt-0.6b-v3"} {
		t.Run(id, func(t *testing.T) {
			report := func(int64, int64) {}
			if _, err := models.EnsureModelRuntime(ctx, dir, id, "", report); err != nil {
				t.Fatal(err)
			}
			model, err := models.Install(ctx, dir, id, report)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, m := range models.List(dir) {
				if m.ID == id && m.Installed {
					found = true
				}
			}
			if !found {
				t.Fatal("downloaded model was not reported installed")
			}
			text, err := (speech.Local{}).Transcribe(ctx, path, speech.Options{Model: model, Language: "en", Prompt: "Yap, country"})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(strings.ToLower(text), "country") {
				t.Fatalf("unexpected transcript: %s", text)
			}
			t.Log(text)
			if id == "moonshine-v2-tiny" || id == "parakeet-tdt-0.6b-v3" {
				cancelCtx, stop := context.WithCancel(ctx)
				timer := time.AfterFunc(100*time.Millisecond, stop)
				start := time.Now()
				_, err := (speech.Local{}).Transcribe(cancelCtx, path, speech.Options{Model: model, Language: "auto"})
				timer.Stop()
				stop()
				if !errors.Is(err, context.Canceled) || time.Since(start) > 3*time.Second {
					t.Fatalf("native cancellation did not stop promptly: %v", err)
				}
			}
		})
	}
}
