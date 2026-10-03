package main

import (
	"context"
	"errors"
	"testing"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func TestGeneratedOutputsCaptureRecipesAndRegenerateWithoutReplacingText(t *testing.T) {
	a := testApp(t)
	config := enableText(t, a, false)
	entry := storage.NewSession("one", 1000, "original", "base", "en", "")
	entry.FinalTranscript = "saved correction"
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.id, a.status.Phase, a.status.Transcript = entry.ID, "done", "previous delivery"
	a.status.Message = "Copied to clipboard"
	a.copyText = func(string) error { t.Error("manual generation changed clipboard"); return nil }
	fake := &fakeTextEngine{output: "summary v1", started: make(chan textCall, 1), release: make(chan struct{})}
	a.textEngine = fake
	done := make(chan error, 1)
	go func() { _, err := a.GenerateSessionOutput("first", entry.ID, "summary"); done <- err }()
	call := <-fake.started
	if call.input != entry.FinalTranscript || call.prompt.Name != "Summary" || call.config.Model != config.Model {
		t.Fatal("incorrect recipe", call)
	}
	if err := a.SaveTranscript(entry.ID, "later correction"); err != nil {
		t.Fatal(err)
	}
	close(fake.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	outputs, err := a.GetSessionOutputs(entry.ID)
	if err != nil || len(outputs) != 1 {
		t.Fatal("output not saved", outputs, err)
	}
	first := outputs[0]
	if first.Input != entry.FinalTranscript || first.Text != "summary v1" || first.Model != config.Model || first.Prompt != call.prompt || first.Endpoint != config.Endpoint {
		t.Fatal("incorrect metadata", first)
	}
	if a.status.Transcript != "later correction" || a.status.Message != "Transcript updated in History" {
		t.Fatal("latest edit lost from status", a.status)
	}
	config.Model, config.Prompts = "new-model", config.Prompts[:1] // Summary was deleted.
	if _, err := a.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	a.textEngine = &fakeTextEngine{output: "summary v2", started: make(chan textCall, 1)}
	if _, err := a.RegenerateSessionOutput("second", entry.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	call = <-a.textEngine.(*fakeTextEngine).started
	if call.input != first.Input || call.prompt != first.Prompt || call.config.Model != "new-model" {
		t.Fatal("regeneration used a different recipe", call)
	}
	outputs, _ = a.GetSessionOutputs(entry.ID)
	if len(outputs) != 2 || outputs[1] != first || outputs[0].ID == first.ID || outputs[0].Model != "new-model" {
		t.Fatal("regeneration replaced its predecessor", outputs)
	}
	got, _ := a.store.Session(entry.ID)
	if got.RawTranscript != entry.RawTranscript || got.FinalTranscript != "later correction" {
		t.Fatal("generation replaced transcript", got)
	}
	if err := a.DeleteSessionOutput(entry.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	outputs, _ = a.GetSessionOutputs(entry.ID)
	if len(outputs) != 1 || outputs[0].Text != "summary v2" {
		t.Fatal("wrong output deleted", outputs)
	}
}

type lateOutputEngine struct {
	started chan struct{}
	release chan struct{}
}

func (f *lateOutputEngine) Process(context.Context, textmodel.Config, textmodel.Prompt, string) (string, error) {
	close(f.started)
	<-f.release
	return "late result", nil // Deliberately ignore cancellation.
}

func TestCancelledOrDeletedDictationCannotSaveLateGeneratedOutput(t *testing.T) {
	for _, cancelled := range []bool{true, false} {
		t.Run(map[bool]string{true: "cancelled", false: "deleted"}[cancelled], func(t *testing.T) {
			a := testApp(t)
			enableText(t, a, false)
			entry := storage.NewSession("one", 1000, "original", "base", "en", "")
			if err := a.store.Add(entry); err != nil {
				t.Fatal(err)
			}
			fake := &lateOutputEngine{started: make(chan struct{}), release: make(chan struct{})}
			a.textEngine = fake
			done := make(chan error, 1)
			go func() { _, err := a.GenerateSessionOutput("late", entry.ID, "summary"); done <- err }()
			<-fake.started
			if cancelled {
				a.CancelTextProcessing("late")
			} else if err := a.DeleteSessions([]string{entry.ID}); err != nil {
				t.Fatal(err)
			}
			close(fake.release)
			if err := <-done; err == nil || cancelled && !errors.Is(err, context.Canceled) {
				t.Fatal("late result accepted", err)
			}
			outputs, _ := a.GetSessionOutputs(entry.ID)
			if len(outputs) != 0 {
				t.Fatal("late output saved", outputs)
			}
			if a.textJobID != "" || a.status.Phase == "text-processing" {
				t.Fatal("generation ownership leaked")
			}
			if cancelled {
				got, _ := a.store.Session(entry.ID)
				if got != entry {
					t.Fatal("cancellation changed transcript", got)
				}
			}
		})
	}
}

func TestGeneratedOutputOperationsGuardMissingDataAndModelErrors(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	if _, err := a.GenerateSessionOutput("missing", "missing", "summary"); err == nil {
		t.Fatal("generated for missing entry")
	}
	entry := storage.NewSession("one", 1000, "original", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.CancelTextProcessing("early")
	if _, err := a.GenerateSessionOutput("early", entry.ID, "summary"); !errors.Is(err, context.Canceled) {
		t.Fatal("early cancellation ignored", err)
	}
	a.textEngine = &fakeTextEngine{output: ""}
	if _, err := a.GenerateSessionOutput("invalid", entry.ID, "summary"); err == nil {
		t.Fatal("saved empty generated output")
	}
	a.textEngine = &fakeTextEngine{err: errors.New("model failed")}
	if _, err := a.GenerateSessionOutput("failed", entry.ID, "summary"); err == nil {
		t.Fatal("model failure accepted")
	}
	outputs, _ := a.GetSessionOutputs(entry.ID)
	if len(outputs) != 0 {
		t.Fatal("failed generation saved output", outputs)
	}
	a.textEngine = &fakeTextEngine{output: "valid"}
	if _, err := a.GenerateSessionOutput("ok", entry.ID, "summary"); err != nil {
		t.Fatal("failed generation prevented retry", err)
	}
	outputs, _ = a.GetSessionOutputs(entry.ID)
	other := storage.NewSession("other", 1000, "other", "base", "en", "")
	a.store.Add(other)
	if _, err := a.RegenerateSessionOutput("wrong-owner", other.ID, outputs[0].ID); err == nil {
		t.Fatal("regenerated another entry's output")
	}
	a.closing = true
	if _, err := a.GetSessionOutputs(entry.ID); err == nil {
		t.Fatal("read during shutdown")
	}
	if err := a.DeleteSessionOutput(entry.ID, outputs[0].ID); err == nil {
		t.Fatal("deleted during shutdown")
	}
}
