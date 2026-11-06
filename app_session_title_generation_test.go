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

func TestGeneratedSessionTitleIsAnExplicitPreview(t *testing.T) {
	a := testApp(t)
	config := enableText(t, a, false)
	entry := storage.NewSession("title", 1000, "Original recording.", "base", "en", "recording.wav")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	if err := a.store.UpdateTranscript(entry.ID, "Edited transcript for the title."); err != nil {
		t.Fatal(err)
	}
	if err := a.store.SaveSessionTitle(entry.ID, "Existing title"); err != nil {
		t.Fatal(err)
	}
	before, _ := a.store.Session(entry.ID)
	a.id = entry.ID
	a.status = Status{Phase: "done", Message: "Saved", Transcript: before.FinalTranscript}
	status := a.status
	a.copyText = func(string) error { t.Error("title generation changed clipboard"); return nil }
	fake := &fakeTextEngine{output: "  \"Meeting\n notes\"  ", started: make(chan textCall, 1)}
	a.textEngine = fake
	title, err := a.GenerateSessionTitle("suggest-title", entry.ID)
	if err != nil || title != "Meeting notes" {
		t.Fatalf("unexpected suggestion: %q %v", title, err)
	}
	call := <-fake.started
	if call.input != before.FinalTranscript || call.config.Model != config.Model || call.prompt.ID != "dictation-title" || !strings.Contains(call.prompt.Instruction, "original language") {
		t.Fatalf("incorrect title request: %+v", call)
	}
	got, _ := a.store.Session(entry.ID)
	outputs, _ := a.store.GeneratedOutputs(entry.ID)
	savedConfig, _ := a.store.TextProcessing()
	if got != before || len(outputs) != 0 || a.status != status || a.textJobID != "" || !reflect.DeepEqual(savedConfig, config) {
		t.Fatal("title preview changed persisted data or dictation state")
	}
	if err := a.RenameSession(entry.ID, title+" reviewed"); err != nil {
		t.Fatal(err)
	}
	got, _ = a.store.Session(entry.ID)
	if got.Title != "Meeting notes reviewed" || got.FinalTranscript != before.FinalTranscript || got.RawTranscript != before.RawTranscript || got.AudioPath != before.AudioPath {
		t.Fatal("explicit title save altered transcript or audio")
	}
}

func TestGeneratedSessionTitleCancellationAndRecovery(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	entry := storage.NewSession("title", 1000, "Saved transcript.", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	fake := &fakeTextEngine{output: "A title", started: make(chan textCall, 1), release: make(chan struct{})}
	a.textEngine = fake
	a.CancelTextProcessing("early-title")
	if _, err := a.GenerateSessionTitle("early-title", entry.ID); !errors.Is(err, context.Canceled) {
		t.Fatal("early cancellation ignored", err)
	}
	done := make(chan error, 1)
	go func() { _, err := a.GenerateSessionTitle("active-title", entry.ID); done <- err }()
	<-fake.started
	if _, err := a.GenerateSessionTitle("concurrent-title", entry.ID); err == nil {
		t.Fatal("concurrent title generation accepted")
	}
	a.CancelTextProcessing("old-title")
	select {
	case <-done:
		t.Fatal("stale cancellation interrupted title generation")
	default:
	}
	a.CancelTextProcessing("active-title")
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("title generation did not cancel")
	}
	fake.release = nil
	fake.err = errors.New("Text model unavailable")
	if _, err := a.GenerateSessionTitle("failed-title", entry.ID); err == nil {
		t.Fatal("model failure was hidden")
	}
	<-fake.started
	fake.err = nil
	title, err := a.GenerateSessionTitle("retry-title", entry.ID)
	if err != nil || title != "A title" || a.textJobID != "" || a.status.Phase != "idle" {
		t.Fatalf("title retry failed or busy state leaked: %q %v", title, err)
	}
	got, _ := a.store.Session(entry.ID)
	if got.Title != "" {
		t.Fatal("cancellation, failure or retry saved a title")
	}
}

func TestGeneratedSessionTitleValidatesSourceAndSuggestion(t *testing.T) {
	a := testApp(t)
	entry := storage.NewSession("title", 1000, "Saved transcript.", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	fake := &fakeTextEngine{output: "Title", started: make(chan textCall, 8)}
	a.textEngine = fake
	if _, err := a.GenerateSessionTitle("disabled-title", entry.ID); err == nil {
		t.Fatal("disabled text model accepted")
	}
	enableText(t, a, false)
	for _, source := range []string{"", "missing"} {
		if _, err := a.GenerateSessionTitle("missing-title", source); err == nil {
			t.Fatal("missing source accepted", source)
		}
	}
	if len(fake.started) != 0 {
		t.Fatal("invalid requests started inference")
	}
	for _, output := range []string{" \n\t", "\"\"", "Bad\x00title", "Bad\x1btitle", string([]byte{0xff})} {
		fake.output = output
		if _, err := a.GenerateSessionTitle("invalid-title", entry.ID); err == nil {
			t.Fatalf("invalid suggestion accepted: %q", output)
		}
	}
	fake.output = strings.Repeat("界", 90)
	title, err := a.GenerateSessionTitle("unicode-title", entry.ID)
	if err != nil || title != strings.Repeat("界", 80) {
		t.Fatalf("title limit split unicode text: %q %v", title, err)
	}
	if err := a.store.Delete(entry.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GenerateSessionTitle("deleted-title", entry.ID); err == nil {
		t.Fatal("deleted source accepted")
	}
}
