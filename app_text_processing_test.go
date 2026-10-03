package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

type textCall struct {
	config textmodel.Config
	prompt textmodel.Prompt
	input  string
}
type fakeTextEngine struct {
	output  string
	err     error
	started chan textCall
	release chan struct{}
}

func (f *fakeTextEngine) Process(ctx context.Context, config textmodel.Config, prompt textmodel.Prompt, input string) (string, error) {
	if f.started != nil {
		f.started <- textCall{config, prompt, input}
	}
	if f.release != nil {
		select {
		case <-f.release:
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	return f.output, f.err
}
func enableText(t *testing.T, a *App, auto bool) textmodel.Config {
	t.Helper()
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "custom-local-model"
	if auto {
		config.AutoPromptID = "summary"
	}
	if _, err := a.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	return config
}

func TestManualPromptPreviewHasNoSideEffectsAndCancelsByIdentity(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	entry := storage.NewSession("one", 1000, "Original.", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.copyText = func(string) error { t.Error("preview copied text"); return nil }
	fake := &fakeTextEngine{output: "Preview.", started: make(chan textCall, 1), release: make(chan struct{})}
	a.textEngine = fake
	done := make(chan error, 1)
	go func() { _, err := a.ProcessText("current", "Unsaved draft.", "summary"); done <- err }()
	call := <-fake.started
	if call.input != "Unsaved draft." || call.config.Model != "custom-local-model" || call.prompt.ID != "summary" {
		t.Fatalf("wrong prompt input: %+v", call)
	}
	if _, err := a.SaveTextProcessing(a.textConfig); err == nil {
		t.Fatal("changed model during preview")
	}
	if err := a.StartRecording(); err == nil {
		t.Fatal("started recording during model inference")
	}
	a.CancelTextProcessing("stale")
	select {
	case <-done:
		t.Fatal("stale request cancelled active one")
	default:
	}
	a.CancelTextProcessing("current")
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("preview did not cancel")
	}
	got, _ := a.store.Session("one")
	if got != entry {
		t.Fatal("preview changed recording")
	}
	if a.status.Phase != "idle" || a.textJobID != "" {
		t.Fatal("processing ownership leaked")
	}
	a.CancelTextProcessing("early")
	a.CancelTextProcessing("another-early")
	if _, err := a.ProcessText("early", "Draft", "summary"); !errors.Is(err, context.Canceled) {
		t.Fatal("early cancellation ignored", err)
	}
	a.textEngine = &fakeTextEngine{output: "Preview."}
	output, err := a.ProcessText("next", "Draft", "cleanup")
	if err != nil || output != "Preview." {
		t.Fatalf("could not retry: %q %v", output, err)
	}
}

func TestAutomaticPromptsUseCapturedConfigAndPreserveOriginal(t *testing.T) {
	a := testApp(t)
	enableText(t, a, true)
	fake := &fakeTextEngine{output: "Summary.", started: make(chan textCall, 1)}
	a.textEngine = fake
	copied := ""
	a.copyText = func(text string) error { copied = text; return nil }
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	// Even an internal preferences replacement cannot change the capture's
	// model/prompt. The public save API rejects changes while recording.
	if _, err := a.SaveTextProcessing(textmodel.Defaults()); err == nil {
		t.Fatal("changed prompts while recording")
	}
	a.textConfig = textmodel.Defaults()
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	call := <-fake.started
	if call.input != "A private thought." || call.prompt.ID != "summary" || call.config.Model != "custom-local-model" {
		t.Fatalf("wrong automatic request: %+v", call)
	}
	entry, err := a.store.Session(a.id)
	if err != nil || entry.RawTranscript != "A private thought." || entry.FinalTranscript != "A private thought." || copied != "Summary." {
		t.Fatalf("incorrect final result: %+v %q %v", entry, copied, err)
	}
	outputs, err := a.GetSessionOutputs(a.id)
	if err != nil || len(outputs) != 1 || outputs[0].Text != "Summary." || outputs[0].Prompt.ID != "summary" || outputs[0].Model != "custom-local-model" {
		t.Fatalf("missing captured output metadata: %+v %v", outputs, err)
	}
}

func TestAutomaticProcessingFailureAndCancellationKeepSpeech(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(map[bool]string{false: "failure", true: "cancel"}[cancel], func(t *testing.T) {
			a := testApp(t)
			enableText(t, a, true)
			fake := &fakeTextEngine{err: errors.New("model unavailable"), started: make(chan textCall, 1)}
			if cancel {
				if err := a.DeleteSessions([]string{a.id}); err == nil {
					t.Fatal("deleted unfinished dictation")
				}
				fake.release = make(chan struct{})
			}
			a.textEngine = fake
			a.copyText = func(string) error { t.Error("failed transformation changed clipboard"); return nil }
			if err := a.StartRecording(); err != nil {
				t.Fatal(err)
			}
			if err := a.StopRecording(); err != nil {
				t.Fatal(err)
			}
			<-fake.started
			if cancel {
				if err := a.SaveTranscript(a.id, "Edit during inference"); err == nil {
					t.Fatal("edited unfinished output")
				}
				if err := a.Cancel(); err != nil {
					t.Fatal(err)
				}
			}
			a.wg.Wait()
			entry, err := a.store.Session(a.id)
			if err != nil || entry.RawTranscript != "A private thought." || entry.FinalTranscript != "A private thought." {
				t.Fatalf("lost speech result: %+v %v", entry, err)
			}
			outputs, err := a.GetSessionOutputs(a.id)
			if err != nil || len(outputs) != 0 {
				t.Fatal("failed generation saved an output", outputs, err)
			}
			if a.status.Phase != "done" || !strings.Contains(a.status.Message, "History") {
				t.Fatalf("failure was not recoverable: %+v", a.status)
			}
		})
	}
}

func TestLocalHTTPModelThroughAppPreviewAndAutomaticDelivery(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body struct {
			Model    string
			Messages []struct{ Content string }
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "custom-local-model" || len(body.Messages) != 2 {
			t.Errorf("bad bridge payload: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"content":"HTTP result."},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()
	a := testApp(t)
	config := enableText(t, a, true)
	config.Endpoint = server.URL + "/v1"
	if _, err := a.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	preview, err := a.ProcessText("http-preview", "Unsaved draft", "summary")
	if err != nil || preview != "HTTP result." {
		t.Fatalf("preview: %q %v", preview, err)
	}
	history, _ := a.store.History()
	if len(history) != 0 {
		t.Fatal("preview created a recording")
	}
	copied := ""
	a.copyText = func(value string) error { copied = value; return nil }
	if err = a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err = a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	entry, err := a.store.Session(a.id)
	if err != nil || entry.RawTranscript != "A private thought." || entry.FinalTranscript != "A private thought." || copied != "HTTP result." || requests != 2 {
		t.Fatalf("HTTP delivery: %+v %q %d %v", entry, copied, requests, err)
	}
}

func TestShutdownCancelsTextWorkAndKeepsCompletedSpeech(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		t.Run(map[bool]string{false: "manual", true: "automatic"}[automatic], func(t *testing.T) {
			a := testApp(t)
			enableText(t, a, automatic)
			fake := &fakeTextEngine{started: make(chan textCall, 1), release: make(chan struct{})}
			a.textEngine = fake
			done := make(chan struct{})
			if automatic {
				a.StartRecording()
				a.StopRecording()
			} else {
				go func() { a.ProcessText("shutdown", "Draft", "summary"); close(done) }()
			}
			<-fake.started
			dir, id := a.store.Dir, a.id
			a.shutdown(a.ctx)
			if !automatic {
				select {
				case <-done:
				case <-time.After(time.Second):
					t.Fatal("shutdown did not await preview")
				}
			}
			if automatic {
				reopened, err := storage.Open(dir)
				if err != nil {
					t.Fatal(err)
				}
				defer reopened.Close()
				entry, err := reopened.Session(id)
				if err != nil || entry.RawTranscript != "A private thought." {
					t.Fatalf("shutdown lost dictation: %+v %v", entry, err)
				}
			}
		})
	}
}

func TestDisabledTextModelMakesNoRequests(t *testing.T) {
	a := testApp(t)
	fake := &fakeTextEngine{started: make(chan textCall, 1)}
	a.textEngine = fake
	if _, err := a.ProcessText("disabled", "Draft", "summary"); err == nil {
		t.Fatal("disabled model called")
	}
	a.StartRecording()
	a.StopRecording()
	a.wg.Wait()
	select {
	case <-fake.started:
		t.Fatal("default dictation invoked LLM")
	default:
	}
}
