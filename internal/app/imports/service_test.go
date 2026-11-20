package imports_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yap/internal/app/imports"
	"yap/internal/audio"
)

func prepare(t *testing.T, paths []string, support imports.Support) imports.Batch {
	t.Helper()
	batch, err := imports.Prepare(context.Background(), paths, "managed-decoder", support)
	if err != nil {
		t.Fatal(err)
	}
	return batch
}

func TestPreparationKeepsInvalidFilesVisibleAndPathsPrivate(t *testing.T) {
	var service imports.Service
	if service.Snapshot() == nil {
		t.Fatal("empty queue must serialize as an array")
	}
	if _, err := imports.Prepare(context.Background(), nil, "", imports.Support{}); err == nil {
		t.Fatal("accepted empty selection")
	}
	source := filepath.Join(t.TempDir(), "secret.wav")
	probed := 0
	service.Enqueue(prepare(t, []string{source, "", "ready.wav"}, imports.Support{Resolve: func(_ context.Context, path, decoder string) (string, error) {
		probed++
		if decoder != "managed-decoder" {
			t.Fatal("lost managed decoder")
		}
		if path == source {
			return "", fmt.Errorf("cannot open %s", source)
		}
		return "installed-decoder", nil
	}}))
	jobs := service.Snapshot()
	if probed != 2 || len(jobs) != 3 || jobs[0].State != "failed" || jobs[0].Error != "cannot open secret.wav" || jobs[1].Error != "choose an audio file" || jobs[2].State != "queued" {
		t.Fatal(jobs, probed)
	}
	data, err := json.Marshal(jobs)
	if err != nil || strings.Contains(string(data), source) {
		t.Fatalf("source leaked: %s %v", data, err)
	}
	jobs[2].State = "done"
	if service.Snapshot()[2].State != "queued" {
		t.Fatal("snapshot shared queue memory")
	}
	if !service.Schedule() || service.Schedule() {
		t.Fatal("scheduled more than one worker")
	}
	service.ResetPending()
	if id := service.Next(); id != jobs[2].ID || service.Next() != "" {
		t.Fatal("selection did not skip failed jobs or claimed twice", id)
	}
}

func TestProgressRejectsInvalidAndStaleReportsAndPreservesCompletedSpeech(t *testing.T) {
	var service imports.Service
	service.Enqueue(prepare(t, []string{"one.wav", "two.wav"}, imports.Support{Resolve: func(context.Context, string, string) (string, error) { return "", nil }}))
	id := service.Next()
	service.Transcribing(id)
	now := time.Now()
	for _, progress := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if service.Progress(id, progress, now) {
			t.Fatal("published nonfinite progress")
		}
	}
	if !service.Progress(id, 42, now) || service.Progress(id, 60, now.Add(time.Millisecond)) || service.Snapshot()[0].Progress != 60 {
		t.Fatal("throttle lost the latest progress")
	}
	if !service.Progress(id, 20, now.Add(time.Second)) || service.Snapshot()[0].Progress != 60 {
		t.Fatal("progress regressed")
	}
	if !service.Progress(id, 200, now.Add(time.Second)) || service.Snapshot()[0].Progress != 100 {
		t.Fatal("completion was not clamped or published")
	}
	if !service.Processing(id) || service.Processing(id) || service.Progress(id, 90, now.Add(2*time.Second)) {
		t.Fatal("processing accepted stale transcription progress")
	}
	service.Finish(id, "saved-session", "Retained speech", "Saved with warning", true, context.Canceled)
	job := service.Snapshot()[0]
	if job.State != "done" || job.Transcript != "Retained speech" || job.Progress != 100 || job.Message != "Saved with warning" {
		t.Fatal("late cancellation hid completed speech", job)
	}
	if service.ActiveID() != "" || service.Progress(id, 80, now.Add(3*time.Second)) {
		t.Fatal("completed job retained worker ownership")
	}
	if service.Next() == "" {
		t.Fatal("completion did not release queue")
	}
}

func TestRetryRetainsBatchConsentAndRechecksStateAfterDiscovery(t *testing.T) {
	var service imports.Service
	batch := prepare(t, []string{"one.mp3", "two.mp3"}, imports.Support{
		Supported: true,
		Resolve:   func(context.Context, string, string) (string, error) { return "", audio.ErrFFmpegMissing },
		Install: func(context.Context, string, func(int64, int64)) (string, error) {
			return "", errors.New("download failed")
		},
	})
	if !batch.NeedsInstall() {
		t.Fatal("missing dependency did not require consent")
	}
	service.Enqueue(batch)
	first := service.Next()
	if !service.Begin(first).Downloading() || service.InstallApproved() {
		t.Fatal("approved install was not consumed once")
	}
	service.Finish(first, "", "", "", false, errors.New("download failed"))
	second := service.Next()
	if service.Begin(second).Downloading() {
		t.Fatal("second job repeated the batch install")
	}
	service.Finish(second, "", "", "", false, audio.ErrFFmpegMissing)
	retry, err := service.Retry(second)
	if err != nil {
		t.Fatal(err)
	}
	result := retry.Prepare(context.Background(), "managed-decoder")
	queued, err := service.ApplyRetry(retry, result)
	if err != nil || !queued || !service.InstallApproved() {
		t.Fatal("dependent retry lost original approval", queued, err)
	}
	if _, err := service.ApplyRetry(retry, result); err == nil {
		t.Fatal("stale retry overwrote an already queued job")
	}
	if service.Next() != second || !service.Begin(second).Downloading() {
		t.Fatal("explicit retry skipped approved dependency")
	}
	service.Finish(second, "", "", "", false, errors.New("download failed again"))
	retry, err = service.Retry(second)
	if err != nil {
		t.Fatal(err)
	}
	result = retry.Prepare(context.Background(), "managed-decoder")
	service.ClearFinished()
	if _, err := service.ApplyRetry(retry, result); err == nil || len(service.Snapshot()) != 0 {
		t.Fatal("unlocked discovery resurrected a cleared job")
	}
}

func TestQueueEditsKeepActiveAndCompletedPositionsAndRejectInvalidOrders(t *testing.T) {
	var service imports.Service
	service.Enqueue(prepare(t, []string{"one.wav", "two.wav", "three.wav"}, imports.Support{Resolve: func(context.Context, string, string) (string, error) { return "", nil }}))
	jobs := service.Snapshot()
	first := service.Next()
	if err := service.Reorder([]string{jobs[1].ID, jobs[1].ID}); err == nil {
		t.Fatal("duplicate order accepted")
	}
	if err := service.Reorder([]string{jobs[2].ID, jobs[1].ID}); err != nil {
		t.Fatal(err)
	}
	if service.Snapshot()[0].ID != first {
		t.Fatal("reorder moved active job")
	}
	if cancel, err := service.Remove(first); err != nil || !cancel || service.Snapshot()[0].Message != "Cancelling…" {
		t.Fatal("active remove lost cancellation", cancel, err)
	}
	if cancel, err := service.Remove(jobs[1].ID); err != nil || cancel {
		t.Fatal("queued remove requested active cancellation", cancel, err)
	}
	service.Finish(first, "", "", "", true, nil)
	if _, err := service.Remove(first); err == nil {
		t.Fatal("removed a completed row through queued removal")
	}
	service.ClearFinished()
	if remaining := service.Snapshot(); len(remaining) != 1 || remaining[0].ID != jobs[2].ID || remaining[0].State != "queued" {
		t.Fatal(remaining)
	}
}

func TestDecodeOwnsDeadlinesClosesCopiesAndStopsAfterFailedDownload(t *testing.T) {
	for _, outcome := range []string{"success", "install-failure", "cancelled"} {
		t.Run(outcome, func(t *testing.T) {
			source := filepath.Join(t.TempDir(), "source.wav")
			file, err := os.Create(source)
			if err != nil {
				t.Fatal(err)
			}
			if err := audio.Header(file, 32000); err != nil {
				t.Fatal(err)
			}
			if _, err := file.Write(make([]byte, 32000)); err != nil {
				t.Fatal(err)
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(source)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var service imports.Service
			support := imports.Support{Resolve: func(context.Context, string, string) (string, error) { return "", nil }}
			if outcome == "install-failure" {
				support.Supported = true
				support.Resolve = func(context.Context, string, string) (string, error) { return "", audio.ErrFFmpegMissing }
				support.Install = func(ctx context.Context, _ string, _ func(int64, int64)) (string, error) {
					deadline, ok := ctx.Deadline()
					if !ok || time.Until(deadline) < 29*time.Minute {
						t.Fatal("lost download deadline")
					}
					return "", errors.New("download failed")
				}
			}
			service.Enqueue(prepare(t, []string{source}, support))
			work := service.Begin(service.Next())
			destination, err := os.Create(filepath.Join(t.TempDir(), "copy.wav"))
			if err != nil {
				t.Fatal(err)
			}
			if outcome == "cancelled" {
				cancel()
			}
			decoding := false
			importCtx, stop, duration, err := work.Decode(ctx, "", destination, imports.DecodeHooks{Decoding: func() { decoding = true }})
			defer stop()
			if _, writeErr := destination.Write([]byte("leak")); !errors.Is(writeErr, os.ErrClosed) {
				t.Fatal("recording copy remained open", writeErr)
			}
			if outcome == "success" {
				deadline, ok := importCtx.Deadline()
				if err != nil || duration != 1000 || !decoding || !ok || time.Until(deadline) < 14*time.Minute {
					t.Fatal("decode did not prepare transcription", duration, err)
				}
			} else if err == nil || decoding {
				t.Fatal("failed preparation resumed decoding", err)
			}
			after, readErr := os.ReadFile(source)
			if readErr != nil || string(after) != string(before) {
				t.Fatal("decode changed original source", readErr)
			}
		})
	}
}
