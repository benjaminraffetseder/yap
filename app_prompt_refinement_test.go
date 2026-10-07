package main

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"yap/internal/storage"
)

func TestRefinePromptUsesDraftConnectionWithoutSaving(t *testing.T) {
	a := testApp(t)
	entry := storage.NewSession("one", 1000, "Original transcript", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.id = entry.ID
	a.status = Status{Phase: "done", Message: "Saved", Transcript: entry.FinalTranscript}
	previous := a.status
	config := a.textConfig
	fake := &fakeTextEngine{output: "Summarize concisely.", started: make(chan textCall, 1)}
	a.textEngine = fake
	a.copyText = func(string) error { t.Error("refinement changed clipboard"); return nil }
	output, err := a.RefinePrompt("refine", "http://localhost:1234/v1", "draft-model", "make a summary")
	if err != nil || output != fake.output {
		t.Fatalf("refinement failed: %q %v", output, err)
	}
	call := <-fake.started
	if call.input != "make a summary" || call.config.Endpoint != "http://127.0.0.1:1234/v1" || call.config.Model != "draft-model" || call.prompt.ID != "refine" {
		t.Fatalf("incorrect request: %+v", call)
	}
	saved, err := a.store.TextProcessing()
	if err != nil || !reflect.DeepEqual(saved, config) || !reflect.DeepEqual(a.textConfig, config) || a.status != previous || a.textJobID != "" {
		t.Fatal("refinement changed settings or dictation state", err)
	}
	got, _ := a.store.Session(entry.ID)
	outputs, _ := a.store.GeneratedOutputs(entry.ID)
	if got != entry || len(outputs) != 0 {
		t.Fatal("refinement changed history")
	}
}

func TestRefinePromptCancellationAndBusyOwnership(t *testing.T) {
	a := testApp(t)
	fake := &fakeTextEngine{output: "Refined", started: make(chan textCall, 1), release: make(chan struct{})}
	a.textEngine = fake
	a.CancelTextProcessing("early")
	if _, err := a.RefinePrompt("early", "http://127.0.0.1:1234/v1", "local", "Summarize"); !errors.Is(err, context.Canceled) {
		t.Fatal("early cancellation ignored", err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := a.RefinePrompt("active", "http://127.0.0.1:1234/v1", "local", "Summarize")
		done <- err
	}()
	<-fake.started
	if err := a.StartRecording(); err == nil {
		t.Fatal("recording allowed during refinement")
	}
	if _, err := a.SaveTextProcessing(a.textConfig); err == nil {
		t.Fatal("save allowed during refinement")
	}
	if _, err := a.RefinePrompt("another", "http://127.0.0.1:1234/v1", "local", "Summarize"); err == nil {
		t.Fatal("concurrent refinement accepted")
	}
	a.CancelTextProcessing("stale")
	select {
	case <-done:
		t.Fatal("stale cancellation interrupted refinement")
	default:
	}
	a.CancelTextProcessing("active")
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("refinement failed to cancel")
	}
	if a.textJobID != "" || a.status.Phase != "idle" {
		t.Fatal("refinement leaked busy state")
	}
	fake.release = nil
	if _, err := a.RefinePrompt("retry", "http://127.0.0.1:1234/v1", "local", "Summarize"); err != nil {
		t.Fatal("refinement failed to retry", err)
	}
}

func TestRefinePromptRejectsInvalidRequestsBeforeInference(t *testing.T) {
	a := testApp(t)
	fake := &fakeTextEngine{started: make(chan textCall, 8)}
	a.textEngine = fake
	for _, tc := range []struct{ id, endpoint, model, input string }{
		{"", "http://127.0.0.1:1234/v1", "local", "Summarize"},
		{"remote", "https://example.com/v1", "local", "Summarize"},
		{"model", "http://127.0.0.1:1234/v1", "", "Summarize"},
		{"empty", "http://127.0.0.1:1234/v1", "local", " "},
		{"long", "http://127.0.0.1:1234/v1", "local", strings.Repeat("x", 8001)},
	} {
		if _, err := a.RefinePrompt(tc.id, tc.endpoint, tc.model, tc.input); err == nil {
			t.Fatalf("invalid request accepted: %+v", tc)
		}
	}
	if len(fake.started) != 0 || a.textJobID != "" || a.status.Phase != "idle" {
		t.Fatal("invalid request started inference")
	}
}
