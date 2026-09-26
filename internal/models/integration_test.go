//go:build windows

package models_test

import (
	"context"
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

func TestRealWhisperInstallationAndTranscription(t *testing.T) {
	if os.Getenv("YAP_INTEGRATION") != "1" {
		t.Skip("set YAP_INTEGRATION=1 for the real runtime/model download smoke test")
	}
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "models"), 0700)
	os.MkdirAll(filepath.Join(dir, "runtime"), 0700)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	report := func(int64, int64) {}
	executable, err := models.InstallRuntime(ctx, dir, report)
	if err != nil {
		t.Fatal(err)
	}
	model, err := models.Install(ctx, dir, "tiny", report)
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.2/samples/jfk.wav", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("sample HTTP %d", resp.StatusCode)
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
	text, err := (speech.Whisper{}).Transcribe(ctx, path, speech.Options{Executable: executable, Model: model, Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(text), "country") {
		t.Fatalf("unexpected transcription: %s", text)
	}
	t.Log(text)
}
