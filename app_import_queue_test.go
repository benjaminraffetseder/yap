package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"yap/internal/audio"
	"yap/internal/inference/speech"
)

type queueSpeech struct {
	started chan string
	release chan error
}

func (e queueSpeech) Transcribe(ctx context.Context, path string, opts speech.Options) (string, error) {
	if opts.Progress != nil {
		opts.Progress(42)
	}
	e.started <- strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	select {
	case err := <-e.release:
		if err != nil {
			return "", err
		}
		if opts.Progress != nil {
			opts.Progress(100)
		}
		return "Result for " + filepath.Base(path), nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func nextQueueStart(t *testing.T, ch <-chan string) string {
	t.Helper()
	select {
	case id := <-ch:
		return id
	case <-time.After(5 * time.Second):
		t.Fatal("queue did not start")
		return ""
	}
}

func TestImportQueueFIFOReorderProgressAndResults(t *testing.T) {
	a := testApp(t)
	e := queueSpeech{make(chan string, 4), make(chan error)}
	a.engine = e
	if err := a.ImportDroppedAudio([]string{importedWAV(t), importedWAV(t), importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	first := nextQueueStart(t, e.started)
	a.mu.Lock()
	initial := a.importSnapshotLocked()
	a.mu.Unlock()
	if initial[0].Progress != 42 || initial[0].State != "transcribing" || a.status.ImportID != initial[0].ID {
		t.Fatal(initial)
	}
	for _, ids := range [][]string{{initial[1].ID}, {initial[1].ID, "unknown"}, {initial[1].ID, initial[1].ID}, {initial[0].ID, initial[1].ID}} {
		if err := a.ReorderImportQueue(ids); err == nil {
			t.Fatal("accepted invalid reorder", ids)
		}
	}
	if err := a.ReorderImportQueue([]string{initial[2].ID, initial[1].ID}); err != nil {
		t.Fatal(err)
	}
	e.release <- nil
	second := nextQueueStart(t, e.started)
	e.release <- nil
	third := nextQueueStart(t, e.started)
	e.release <- nil
	a.wg.Wait()
	jobs := a.importSnapshotLocked()
	if a.status.ImportID != "" {
		t.Fatal("completed import identity leaked into the next operation")
	}
	if jobs[0].Transcript != "Result for "+first+".wav" || jobs[1].ID != initial[2].ID || jobs[1].Transcript != "Result for "+second+".wav" || jobs[2].Transcript != "Result for "+third+".wav" {
		t.Fatal(jobs)
	}
	for _, job := range jobs {
		if job.State != "done" || job.Transcript == "" || job.Progress != 100 {
			t.Fatal(job)
		}
	}
	data, _ := json.Marshal(jobs)
	if strings.Contains(string(data), a.importQueue[0].source) {
		t.Fatal("source path exposed")
	}
}

func TestImportQueueWaitsForRecordingAndResumes(t *testing.T) {
	a := testApp(t)
	e := queueSpeech{make(chan string, 2), make(chan error)}
	a.engine = e
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err := a.ImportDroppedAudio([]string{importedWAV(t), importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	if a.importActive != "" || a.importQueue[0].State != "queued" {
		t.Fatal("queue interrupted recording")
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	nextQueueStart(t, e.started)
	if err := a.StartRecording(); err == nil {
		t.Fatal("dictation interrupted active import")
	}
	e.release <- nil
	nextQueueStart(t, e.started)
	e.release <- nil
	a.wg.Wait()
}

func TestImportQueueRemoveCancelRetryAndClear(t *testing.T) {
	a := testApp(t)
	e := queueSpeech{make(chan string, 3), make(chan error)}
	a.engine = e
	if err := a.ImportDroppedAudio([]string{importedWAV(t), importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	nextQueueStart(t, e.started)
	a.mu.Lock()
	ids := a.importSnapshotLocked()
	a.mu.Unlock()
	if err := a.RemoveImport(ids[1].ID); err != nil {
		t.Fatal(err)
	}
	if err := a.RemoveImport(ids[0].ID); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if len(a.importQueue) != 1 || a.importQueue[0].State != "cancelled" {
		t.Fatal(a.importSnapshotLocked())
	}
	if err := a.RetryImport(ids[0].ID); err != nil {
		t.Fatal(err)
	}
	nextQueueStart(t, e.started)
	e.release <- nil
	a.wg.Wait()
	if err := a.RetryImport(ids[0].ID); err == nil {
		t.Fatal("retried completed job")
	}
	if err := a.ClearFinishedImports(); err != nil {
		t.Fatal(err)
	}
	if len(a.importQueue) != 0 {
		t.Fatal(a.importQueue)
	}
}

func TestImportQueueFailureContinuesAndHistoryOffKeepsResults(t *testing.T) {
	a := testApp(t)
	a.settings.SaveHistory = false
	e := queueSpeech{make(chan string, 3), make(chan error)}
	a.engine = e
	if err := a.ImportDroppedAudio([]string{importedWAV(t), importedWAV(t), importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	nextQueueStart(t, e.started)
	e.release <- errors.New("speech failed")
	nextQueueStart(t, e.started)
	e.release <- nil
	nextQueueStart(t, e.started)
	e.release <- nil
	a.wg.Wait()
	jobs := a.importSnapshotLocked()
	if jobs[0].State != "failed" || jobs[1].State != "done" || jobs[2].State != "done" || jobs[1].Transcript == jobs[2].Transcript || jobs[1].SessionID != "" || jobs[2].SessionID != "" {
		t.Fatal(jobs)
	}
	if history, _ := a.store.History(); len(history) != 0 {
		t.Fatal(history)
	}
	if a.latestResult.Text != jobs[2].Transcript {
		t.Fatal("latest result inconsistent")
	}
}

func TestImportQueueShutdownStopsPump(t *testing.T) {
	a := testApp(t)
	e := queueSpeech{make(chan string, 3), make(chan error)}
	a.engine = e
	if err := a.ImportDroppedAudio([]string{importedWAV(t), importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	nextQueueStart(t, e.started)
	a.shutdown(a.ctx)
	if a.importQueue[1].State != "queued" {
		t.Fatal("started next file during shutdown")
	}
	select {
	case <-e.started:
		t.Fatal("extra transcription")
	default:
	}
}

func TestImportQueueMixedDropAndSingleBatchConfirmation(t *testing.T) {
	a := testApp(t)
	a.engine = importedSpeech{}
	if err := a.ImportDroppedAudio([]string{filepath.Join(t.TempDir(), "no.wav"), importedWAV(t), "bad.txt", importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	states := []string{}
	for _, job := range a.importQueue {
		states = append(states, job.State)
	}
	if !reflect.DeepEqual(states, []string{"failed", "done", "failed", "done"}) {
		t.Fatal(states)
	}
	confirmed, installed := 0, 0
	err := a.prepareAudioImports([]string{importedWAV(t), importedWAV(t)}, audioImportSupport{
		supported: true,
		resolve:   func(context.Context, string, string) (string, error) { return "", audio.ErrFFmpegMissing },
		confirm:   func() (bool, error) { confirmed++; return true, nil },
		install:   func(context.Context, string, func(int64, int64)) (string, error) { installed++; return "", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if confirmed != 1 || installed != 1 {
		t.Fatal(confirmed, installed)
	}
}

func TestImportQueueRetriesRepairedFile(t *testing.T) {
	a := testApp(t)
	a.engine = importedSpeech{}
	path := filepath.Join(t.TempDir(), "repaired.wav")
	if err := a.ImportDroppedAudio([]string{path}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(importedWAV(t))
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.RetryImport(a.importQueue[0].ID); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if a.importQueue[0].State != "done" {
		t.Fatal(a.importSnapshotLocked())
	}
}

func TestImportQueueScheduledPumpRechecksBusyAndProgressIsThrottled(t *testing.T) {
	a := testApp(t)
	e := queueSpeech{make(chan string, 1), make(chan error)}
	a.engine = e
	job := &importJob{ImportJob: ImportJob{ID: "queued", Name: "audio.wav", State: "queued", Progress: -1}, source: importedWAV(t)}
	progressEvents := 0
	a.notify = func(topic string, args ...interface{}) {
		if topic == "import:queue" {
			for _, job := range args[0].([]ImportJob) {
				if job.State == "transcribing" && job.Progress >= 0 {
					progressEvents++
				}
			}
		}
	}
	a.mu.Lock()
	a.importQueue = []*importJob{job}
	a.pumpImportQueueLocked()
	a.status.Phase = "recording"
	a.mu.Unlock()
	a.wg.Wait()
	if job.State != "queued" {
		t.Fatal("scheduled pump did not yield")
	}
	a.mu.Lock()
	a.status.Phase = "idle"
	a.emit()
	a.mu.Unlock()
	nextQueueStart(t, e.started)
	a.importProgress(job, 50)
	a.importProgress(job, 60)
	a.mu.Lock()
	if progressEvents != 1 || job.Progress != 60 {
		t.Fatal(progressEvents, job.Progress)
	}
	job.lastProgress = time.Now().Add(-time.Second)
	a.mu.Unlock()
	a.importProgress(job, 70)
	a.mu.Lock()
	if progressEvents != 2 {
		t.Fatal("missing throttled progress", progressEvents)
	}
	a.mu.Unlock()
	e.release <- nil
	a.wg.Wait()
}
