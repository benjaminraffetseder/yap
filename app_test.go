package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
	"yap/internal/indicator"
	"yap/internal/inference/speech"
	"yap/internal/storage"
)

type fakeCapture struct{}

func (fakeCapture) Start(path string, level func(float64)) error {
	level(0.5)
	return os.WriteFile(path, []byte("audio"), 0600)
}

type fakeIndicator struct {
	mu     sync.Mutex
	states []indicator.State
	levels []float64
	closed bool
}

func (f *fakeIndicator) Update(s indicator.State) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.states = append(f.states, s)
}
func (f *fakeIndicator) SetLevel(level float64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.levels = append(f.levels, level)
}
func (f *fakeIndicator) Close() { f.closed = true }

func TestIndicatorFollowsDictationWithoutFrontend(t *testing.T) {
	a := testApp(t)
	f := &fakeIndicator{}
	a.indicator = f
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.states) != 3 || f.states[0].Phase != "recording" || f.states[1].Phase != "transcribing" || f.states[2].Phase != "done" || f.states[2].Message != "Copied to clipboard" {
		t.Fatalf("indicator missed state updates: %+v", f.states)
	}
	if len(f.levels) != 1 || f.levels[0] != 0.5 {
		t.Fatalf("audio activity missing: %v", f.levels)
	}
	// Model/download and settings events must not reopen a dictation indicator.
	a.mu.Lock()
	a.status = Status{Phase: "error", Message: "model download failed"}
	a.emit()
	a.mu.Unlock()
	if len(f.states) != 3 {
		t.Fatal("unrelated operation displayed indicator")
	}
}

func TestIndicatorShowsFailedStartAndCancellation(t *testing.T) {
	a := testApp(t)
	f := &fakeIndicator{}
	a.indicator = f
	model := a.settings.ModelPath
	a.settings.ModelPath = ""
	a.hotkeyDown()
	if len(f.states) != 1 || f.states[0].Phase != "error" {
		t.Fatal("hotkey failure invisible while minimized")
	}
	a.settings.ModelPath = model
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	if len(f.states) != 3 || f.states[2].Phase != "idle" || f.states[2].Message != "Recording discarded" {
		t.Fatalf("cancel status missing: %+v", f.states)
	}
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
