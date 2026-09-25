package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
	"yap/internal/inference/speech"
	"yap/internal/storage"
)

type fakeCapture struct{}

func (fakeCapture) Start(path string, level func(float64)) error {
	return os.WriteFile(path, []byte("audio"), 0600)
}
func (fakeCapture) Stop() (int64, error) { return 2000, nil }

type fakeSpeech struct {
	wait    bool
	started chan struct{}
}

func (f fakeSpeech) Transcribe(ctx context.Context, path string, opts speech.Options) (string, error) {
	if f.started != nil {
		close(f.started)
	}
	if f.wait {
		<-ctx.Done()
		return "", ctx.Err()
	}
	return "A private thought.", nil
}
func testApp(t *testing.T) *App {
	t.Helper()
	a := NewApp()
	a.ctx = context.Background()
	var err error
	a.store, err = storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.shutdown(a.ctx) })
	a.recorder = fakeCapture{}
	a.engine = fakeSpeech{}
	a.settings.WhisperPath, _ = os.Executable()
	a.settings.ModelPath = filepath.Join(a.store.Dir, "models", "test.bin")
	os.WriteFile(a.settings.ModelPath, []byte("model"), 0600)
	a.copyText = func(string) error { return nil }
	return a
}
func TestRecordingPipelineRetention(t *testing.T) {
	for _, retain := range []bool{false, true} {
		t.Run(map[bool]string{false: "temporary", true: "retained"}[retain], func(t *testing.T) {
			a := testApp(t)
			a.settings.SaveAudio = retain
			if err := a.StartRecording(); err != nil {
				t.Fatal(err)
			}
			path := a.path
			if err := a.StartRecording(); err == nil {
				t.Fatal("allowed concurrent recording")
			}
			if err := a.StopRecording(); err != nil {
				t.Fatal(err)
			}
			a.wg.Wait()
			snap, err := a.GetSnapshot()
			if err != nil {
				t.Fatal(err)
			}
			if snap.Status.Phase != "done" || len(snap.History) != 1 || snap.History[0].RawTranscript != "A private thought." {
				t.Fatalf("pipeline failed: %+v", snap)
			}
			_, err = os.Stat(path)
			if retain && err != nil {
				t.Fatal("lost retained audio")
			}
			if !retain && !os.IsNotExist(err) {
				t.Fatal("temporary audio leaked")
			}
		})
	}
}
func TestCancelRecordingAndTranscription(t *testing.T) {
	a := testApp(t)
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	path := a.path
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("discarded recording leaked")
	}
	started := make(chan struct{})
	a.engine = fakeSpeech{wait: true, started: started}
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	path = a.path
	a.StopRecording()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("inference did not start")
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	snap, err := a.GetSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.History) != 0 || snap.Status.Phase != "idle" {
		t.Fatal("cancelled transcription was saved")
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("cancelled audio leaked")
	}
}
