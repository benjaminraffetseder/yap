package app

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func outputEditingApp(t *testing.T) (*App, storage.Session, storage.GeneratedOutput) {
	t.Helper()
	a := testApp(t)
	entry := storage.NewSession("editing", 1000, "Recognized speech", "base", "en", "")
	entry.FinalTranscript = "Corrected transcript"
	config := textmodel.Defaults()
	config.Model = "local-model"
	output := storage.NewGeneratedOutput(entry.ID, entry.FinalTranscript, "Generated original", config, config.Prompts[1])
	if err := a.store.AddWithOutputs(entry, []storage.GeneratedOutput{output}); err != nil {
		t.Fatal(err)
	}
	return a, entry, output
}

func TestSaveSessionOutputSynchronizesCurrentHomeAndRejectsStaleActions(t *testing.T) {
	a, entry, original := outputEditingApp(t)
	a.id, a.status.Phase, a.status.Transcript = entry.ID, "done", original.Text
	a.homeResult = &HomeResult{Session: entry, Outputs: []storage.GeneratedOutput{original}, Text: original.Text, OutputID: original.ID, Saved: true,
		Outcomes: HomeOutcomes{Clipboard: "complete", Paste: "complete"}}
	before := homeResult(t, a)
	historyEvents := 0
	a.notify = func(topic string, _ ...interface{}) {
		if topic == "dictation:history" {
			historyEvents++
		}
	}
	edited, err := a.SaveSessionOutput(entry.ID, original.ID, "Edited **output**", original.Text)
	if err != nil || edited.Text != "Edited **output**" || !edited.Edited || edited.OriginalText != original.Text {
		t.Fatal("output save did not return current/original text", edited, err)
	}
	if a.status.Transcript != edited.Text || a.homeResult.Text != edited.Text || a.homeResult.Outcomes.Clipboard != "skipped" || a.homeResult.Outcomes.Paste != "skipped" {
		t.Fatal("current result retained stale output/delivery state", a.status, a.homeResult)
	}
	if historyEvents != 1 {
		t.Fatal("output save omitted History notification", historyEvents)
	}
	if _, err := a.SaveSessionOutput(entry.ID, original.ID, edited.Text, edited.Text); err != nil || historyEvents != 1 {
		t.Fatal("no-op output save changed state", err, historyEvents)
	}
	if _, err := a.SaveSessionOutput(entry.ID, original.ID, "Stale save", original.Text); !errors.Is(err, storage.ErrContentChanged) || historyEvents != 1 {
		t.Fatal("stale output write accepted or published", err, historyEvents)
	}
	for _, action := range []string{"edit", "copy", "copy:" + original.ID} {
		if err := a.HomeResultAction(entry.ID, before.Revision, action, "stale"); err == nil {
			t.Fatal("Home action ignored edited output version", action)
		}
	}
	current := homeResult(t, a)
	if current.Revision == before.Revision || current.Text != edited.Text || !reflect.DeepEqual(current.Outputs, []storage.GeneratedOutput{edited}) {
		t.Fatal("Home did not resolve current output", current)
	}
	copied := ""
	a.copyText = func(text string) error { copied = text; return nil }
	if err := a.HomeResultAction(entry.ID, current.Revision, "copy:"+original.ID, ""); err != nil || copied != edited.Text {
		t.Fatal("copy used original generation", copied, err)
	}
	versions, err := a.GetRevisions("output", original.ID)
	if err != nil || len(versions) != 2 || versions[1].Value != original.Text {
		t.Fatal("output version history unavailable", versions, err)
	}
	if err := a.SaveTranscriptChecked(entry.ID, "Current transcript", entry.FinalTranscript); err != nil {
		t.Fatal(err)
	}
	if err := a.SaveTranscriptChecked(entry.ID, "Stale transcript", entry.FinalTranscript); !errors.Is(err, storage.ErrContentChanged) {
		t.Fatal("transcript API ignored baseline", err)
	}
	saved, err := a.store.Session(entry.ID)
	if err != nil || saved.RawTranscript != entry.RawTranscript || saved.FinalTranscript != "Current transcript" {
		t.Fatal("transcript API lost speech provenance", saved, err)
	}
	current = homeResult(t, a)
	if current.Text != saved.FinalTranscript || current.OutputID != "" {
		t.Fatal("transcript save did not refresh Home", current)
	}
}

func TestContentEditingAPIsRespectAvailabilityAndTemporaryResults(t *testing.T) {
	for _, state := range []string{"backup", "home-action", "closing", "transcribing"} {
		t.Run(state, func(t *testing.T) {
			a, entry, output := outputEditingApp(t)
			switch state {
			case "backup":
				a.status.Phase = "backup"
			case "home-action":
				a.homeResultOperation = true
			case "closing":
				a.closing = true
			case "transcribing":
				a.id, a.status.Phase = entry.ID, "transcribing"
			}
			if err := a.SaveTranscriptChecked(entry.ID, "Blocked transcript", entry.FinalTranscript); err == nil {
				t.Fatal("transcript save ignored operation guard", state)
			}
			if _, err := a.SaveSessionOutput(entry.ID, output.ID, "Blocked output", output.Text); err == nil {
				t.Fatal("output save ignored operation guard", state)
			}
			a.closing, a.homeResultOperation, a.status.Phase = false, false, "done"
			got, err := a.store.GeneratedOutput(entry.ID, output.ID)
			if err != nil || !reflect.DeepEqual(got, output) {
				t.Fatal("blocked save changed output", got, err)
			}
		})
	}
	t.Run("temporary", func(t *testing.T) {
		a := testApp(t)
		a.SetSaveHistory(false)
		enableText(t, a, true)
		a.textEngine = &fakeTextEngine{output: "Temporary generated original"}
		recordTemporary(t, a)
		result := homeResult(t, a)
		if result.Saved || len(result.Outputs) != 1 {
			t.Fatal("fixture is not a temporary generated result", result)
		}
		if err := a.SaveTranscriptChecked(result.Session.ID, "Unwanted save", result.Session.FinalTranscript); err == nil {
			t.Fatal("checked transcript API persisted temporary result")
		}
		if _, err := a.SaveSessionOutput(result.Session.ID, result.Outputs[0].ID, "Unwanted save", result.Outputs[0].Text); err == nil {
			t.Fatal("output edit persisted temporary result")
		}
		history, err := a.store.History()
		if err != nil || len(history) != 0 {
			t.Fatal("editing created History", history, err)
		}
	})
}

func TestEditedOutputsFeedExportChatAndKeepRegenerationSnapshots(t *testing.T) {
	a, entry, original := outputEditingApp(t)
	enableText(t, a, false)
	current := "Current edited output"
	if _, err := a.SaveSessionOutput(entry.ID, original.ID, current, original.Text); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "current.md")
	exportTo(t, a, TranscriptExportRequest{SessionIDs: []string{entry.ID}, Format: "markdown", Destination: "file", IncludeOutputs: true, OutputIDs: []string{original.ID}}, destination)
	body, err := os.ReadFile(destination)
	if err != nil || !strings.Contains(string(body), current) || strings.Contains(string(body), original.Text) {
		t.Fatal("export did not use current output", string(body), err)
	}
	a.textEngine = &fakeChatEngine{chat: func(context.Context, []textmodel.Message, func(string)) (string, error) {
		return "Saved conversation answer", nil
	}}
	chat, err := a.SendChatMessage("edited-output-chat", entry.ID, ChatRequest{Source: "transcript", OutputID: original.ID, Message: "Discuss this output"})
	if err != nil || len(chat.Messages) != 2 || chat.Messages[0].OutputText != current {
		t.Fatal("new chat did not capture current output", chat, err)
	}
	if _, err := a.SaveSessionOutput(entry.ID, original.ID, "Later edit", current); err != nil {
		t.Fatal(err)
	}
	chat, err = a.GetSessionChat(entry.ID)
	if err != nil || chat.Messages[0].OutputText != current {
		t.Fatal("output edit changed earlier conversation snapshot", chat, err)
	}
	fake := &fakeTextEngine{output: "Regenerated separate result", started: make(chan textCall, 1)}
	a.textEngine = fake
	if _, err := a.RegenerateSessionOutput("regenerated-edited-output", entry.ID, original.ID); err != nil {
		t.Fatal(err)
	}
	call := <-fake.started
	if call.input != original.Input || call.prompt != original.Prompt {
		t.Fatal("regeneration used edited text instead of captured recipe", call)
	}
	outputs, err := a.GetSessionOutputs(entry.ID)
	if err != nil || len(outputs) != 2 {
		t.Fatal("regeneration replaced edited output", outputs, err)
	}
	for _, output := range outputs {
		if output.ID == original.ID && (output.Text != "Later edit" || output.OriginalText != original.Text) {
			t.Fatal("regeneration changed edited predecessor", output)
		}
	}
}

func TestOutputEditDuringTextJobKeepsCurrentResultWhenJobFinishes(t *testing.T) {
	a, entry, output := outputEditingApp(t)
	enableText(t, a, false)
	a.id, a.status.Phase, a.status.Transcript = entry.ID, "done", output.Text
	a.homeResult = &HomeResult{Session: entry, Outputs: []storage.GeneratedOutput{output}, Text: output.Text, OutputID: output.ID, Saved: true}
	fake := &fakeTextEngine{output: "Separate generated output", started: make(chan textCall, 1), release: make(chan struct{})}
	a.textEngine = fake
	done := make(chan error, 1)
	go func() { _, err := a.GenerateSessionOutput("parallel-output", entry.ID, "summary"); done <- err }()
	<-fake.started
	if _, err := a.SaveSessionOutput(entry.ID, output.ID, "Edited during inference", output.Text); err != nil {
		close(fake.release)
		<-done
		t.Fatal(err)
	}
	close(fake.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if a.status.Phase != "done" || a.status.Transcript != "Edited during inference" || a.status.Message != "Output updated in History" {
		t.Fatal("text job restored obsolete output presentation", a.status)
	}
	current := homeResult(t, a)
	if current.Text != "Edited during inference" || current.OutputID != output.ID {
		t.Fatal("text job replaced currently edited output", current)
	}
}

func TestDeletingCurrentOutputFallsBackToTranscriptAcrossTextJobs(t *testing.T) {
	for _, mode := range []string{"immediate", "process", "refinement", "storage-deletion", "transcript-edit"} {
		t.Run(mode, func(t *testing.T) {
			a, entry, output := outputEditingApp(t)
			enableText(t, a, false)
			survivor := storage.NewGeneratedOutput(entry.ID, output.Input, "Another surviving output", a.textConfig, output.Prompt)
			if err := a.store.AddGeneratedOutput(survivor); err != nil {
				t.Fatal(err)
			}
			a.id, a.status.Phase, a.status.Transcript = entry.ID, "done", output.Text
			a.homeResult = &HomeResult{Session: entry, Outputs: []storage.GeneratedOutput{output, survivor}, Text: output.Text, OutputID: output.ID, Saved: true,
				Outcomes: HomeOutcomes{Clipboard: "complete", Paste: "complete"}}
			before := homeResult(t, a)
			var done chan error
			var release chan struct{}
			if mode != "immediate" {
				release, done = make(chan struct{}), make(chan error, 1)
				fake := &fakeTextEngine{output: "Reviewed selection", started: make(chan textCall, 1), release: release}
				a.textEngine = fake
				go func() {
					var err error
					if mode == "refinement" {
						_, err = a.RefineSelection("delete-output-refinement", "rewrite", "Captured selection", "", "")
					} else {
						_, err = a.ProcessText("delete-output-processing", "Captured selection", "summary")
					}
					done <- err
				}()
				<-fake.started
				defer func() {
					if release != nil {
						close(release)
						<-done
					}
				}()
			}
			assertCurrent := func(expectedText string) {
				t.Helper()
				if a.homeResult.OutputID != "" || a.homeResult.Text != expectedText || len(a.homeResult.Outputs) != 1 || a.homeResult.Outputs[0].ID != survivor.ID {
					t.Fatal("deleted output remained selected or replaced by another output", a.homeResult)
				}
				if a.homeResult.Outcomes.Clipboard != "skipped" || a.homeResult.Outcomes.Paste != "skipped" || a.status.Transcript != expectedText {
					t.Fatal("deleted output retained delivery/current text", a.status, a.homeResult)
				}
			}
			if mode == "storage-deletion" {
				if err := a.store.DeleteGeneratedOutput(entry.ID, output.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := a.DeleteSessionOutput(entry.ID, output.ID); err != nil {
					t.Fatal(err)
				}
				assertCurrent(entry.FinalTranscript)
			}
			expectedText := entry.FinalTranscript
			if mode == "transcript-edit" {
				expectedText = "Transcript changed during inference"
				if err := a.SaveTranscriptChecked(entry.ID, expectedText, entry.FinalTranscript); err != nil {
					t.Fatal(err)
				}
			}
			if release != nil {
				close(release)
				release = nil
				if err := <-done; err != nil {
					t.Fatal(err)
				}
			}
			assertCurrent(expectedText)
			if mode == "transcript-edit" && a.status.Message != "Transcript updated in History" {
				t.Fatal("output reconciliation overrode transcript update", a.status)
			}
			if a.status.Phase != "done" {
				t.Fatal("text job failed to restore done phase", a.status)
			}
			if _, err := a.store.GeneratedOutput(entry.ID, output.ID); !errors.Is(err, sql.ErrNoRows) {
				t.Fatal("text job resurrected deleted output", err)
			}
			if err := a.HomeResultAction(entry.ID, before.Revision, "copy", ""); err == nil {
				t.Fatal("deleted output's Home revision remained actionable")
			}
			current := homeResult(t, a)
			copied := ""
			a.copyText = func(text string) error { copied = text; return nil }
			if err := a.HomeResultAction(entry.ID, current.Revision, "copy", ""); err != nil || copied != expectedText {
				t.Fatal("current Home copy used deleted output instead of transcript", copied, err)
			}
		})
	}
}

func TestDeletingOtherOutputPreservesCurrentSelectedOutput(t *testing.T) {
	a, entry, output := outputEditingApp(t)
	other := output
	other.ID, other.Text, other.OriginalText = "other-output", "Other output", "Other output"
	if err := a.store.AddGeneratedOutput(other); err != nil {
		t.Fatal(err)
	}
	a.id, a.status.Phase, a.status.Transcript = entry.ID, "done", output.Text
	a.homeResult = &HomeResult{Session: entry, Outputs: []storage.GeneratedOutput{output, other}, Text: output.Text, OutputID: output.ID, Saved: true,
		Outcomes: HomeOutcomes{Clipboard: "complete", Paste: "complete"}}
	if err := a.DeleteSessionOutput(entry.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	if a.homeResult.Text != output.Text || a.homeResult.OutputID != output.ID || len(a.homeResult.Outputs) != 1 || a.homeResult.Outputs[0].ID != output.ID || a.status.Transcript != output.Text {
		t.Fatal("deleting another output changed current selection", a.status, a.homeResult)
	}
	if a.homeResult.Outcomes.Clipboard != "complete" || a.homeResult.Outcomes.Paste != "complete" {
		t.Fatal("unchanged selected output lost delivery state", a.homeResult)
	}
}
