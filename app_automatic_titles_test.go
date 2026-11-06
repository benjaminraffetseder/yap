package main

import (
	"context"
	"errors"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func TestAutomaticTitlesRemainGlobalWhenApplyingProfiles(t *testing.T) {
	a := testApp(t)
	profile, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Notes", ModelPath: a.settings.ModelPath, Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyDictationProfile(profile.ID); err != nil {
		t.Fatal(err)
	}
	settings := a.settings
	settings.AutoGenerateTitles = true
	if err := a.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	snapshot, err := a.GetSnapshot()
	if err != nil || snapshot.ProfileModified {
		t.Fatal("global preference marked profile modified", snapshot, err)
	}
	if err := a.ApplyDictationProfile(profile.ID); err != nil {
		t.Fatal(err)
	}
	saved, err := a.store.Settings()
	if err != nil || !a.settings.AutoGenerateTitles || !saved.AutoGenerateTitles {
		t.Fatal("applying profile reset automatic titles", saved, err)
	}
}

func TestAutomaticTitlesRequireOptInHistoryAndTextModel(t *testing.T) {
	for _, tc := range []struct {
		name                        string
		automatic, history, enabled bool
	}{
		{"default", false, true, true},
		{"temporary", true, false, true},
		{"disabled model", true, true, false},
		{"enabled", true, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := testApp(t)
			if tc.enabled {
				enableText(t, a, false)
			}
			settings := a.settings
			settings.AutoGenerateTitles, settings.SaveHistory = tc.automatic, tc.history
			if err := a.SaveSettings(settings); err != nil {
				t.Fatal(err)
			}
			engine := &fakeTextEngine{output: "  \"Private\n thought\"  ", started: make(chan textCall, 1)}
			a.textEngine = engine
			copied := ""
			a.copyText = func(text string) error { copied = text; return nil }
			if err := a.StartRecording(); err != nil {
				t.Fatal(err)
			}
			// Recording captures the preference and text-model configuration.
			a.settings.AutoGenerateTitles = false
			a.textConfig = textmodel.Defaults()
			if err := a.StopRecording(); err != nil {
				t.Fatal(err)
			}
			a.wg.Wait()
			want := tc.automatic && tc.history && tc.enabled
			if (len(engine.started) == 1) != want || copied != "A private thought." {
				t.Fatalf("unexpected inference or delivery: calls=%d copied=%q", len(engine.started), copied)
			}
			history, err := a.store.History()
			if err != nil || (len(history) == 1) != tc.history {
				t.Fatal("unexpected saved history", history, err)
			}
			if tc.history {
				title := ""
				if want {
					title = "Private thought"
					call := <-engine.started
					if call.prompt.ID != "dictation-title" || call.input != history[0].FinalTranscript || call.config.Model != "custom-local-model" {
						t.Fatal("incorrect title request", call)
					}
				}
				if history[0].Title != title || history[0].FinalTranscript != "A private thought." || history[0].RawTranscript != "A private thought." {
					t.Fatal("title generation changed transcript", history[0])
				}
			}
		})
	}
}

func TestAutomaticTitlesFollowPromptsAndClipboardDelivery(t *testing.T) {
	a := testApp(t)
	enableText(t, a, true)
	a.settings.AutoGenerateTitles = true
	copied := ""
	a.copyText = func(text string) error { copied = text; return nil }
	engine := &chainTextEngine{process: func(index int, _ context.Context) (string, error) {
		if index == 0 {
			return "Summary.", nil
		}
		if copied != "Summary." {
			t.Error("title inference delayed clipboard delivery")
		}
		return "Private thought", nil
	}}
	a.textEngine = engine
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if len(engine.calls) != 2 || engine.calls[0].prompt.ID != "summary" || engine.calls[1].prompt.ID != "dictation-title" || engine.calls[1].input != "A private thought." {
		t.Fatal("incorrect automatic processing order", engine.calls)
	}
	entry, err := a.store.Session(a.id)
	outputs, outputErr := a.GetSessionOutputs(a.id)
	if err != nil || outputErr != nil || entry.Title != "Private thought" || len(outputs) != 1 || outputs[0].Text != "Summary." || copied != "Summary." || a.status.Transcript != "Summary." {
		t.Fatal("title generation changed generated output or delivery", entry, outputs, err, outputErr)
	}
}

func TestAutomaticTitleFailureKeepsSavedTranscriptAndDelivery(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		t.Run(map[bool]string{false: "model failure", true: "invalid title"}[invalid], func(t *testing.T) {
			a := testApp(t)
			enableText(t, a, false)
			a.settings.AutoGenerateTitles = true
			engine := &fakeTextEngine{err: errors.New("model unavailable")}
			if invalid {
				engine.err, engine.output = nil, "\"\""
			}
			a.textEngine = engine
			copied := ""
			a.copyText = func(text string) error { copied = text; return nil }
			if err := a.StartRecording(); err != nil {
				t.Fatal(err)
			}
			if err := a.StopRecording(); err != nil {
				t.Fatal(err)
			}
			a.wg.Wait()
			entry, err := a.store.Session(a.id)
			jobs := a.bulkTextSnapshotLocked()
			if err != nil || entry.Title != "" || entry.FinalTranscript != "A private thought." || copied != entry.FinalTranscript || a.status.Phase != "done" || len(jobs) != 1 || jobs[0].State != "failed" || jobs[0].Error == "" {
				t.Fatal("failed title lost speech or hid its error", entry, jobs, err)
			}
		})
	}
}

func TestAutomaticTitlesForAudioImports(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	a.settings.AutoGenerateTitles = true
	a.textEngine = &fakeTextEngine{output: "Imported thought"}
	a.copyText = func(string) error { t.Error("import title changed clipboard"); return nil }
	if err := a.ImportDroppedAudio([]string{importedWAV(t), importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	history, err := a.store.History()
	if err != nil || len(history) != 2 {
		t.Fatal("imports were not saved", history, err)
	}
	for _, entry := range history {
		if entry.Title != "Imported thought" || entry.FinalTranscript != "A private thought." {
			t.Fatal("import title or transcript incorrect", entry)
		}
	}
	for _, job := range a.importQueue {
		if job.State != "done" {
			t.Fatal("title generation affected import completion", job)
		}
	}
}

func TestAutomaticTitleKeepsManualRenameAndCanBeCancelled(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(map[bool]string{false: "manual rename", true: "cancel"}[cancel], func(t *testing.T) {
			a := testApp(t)
			enableText(t, a, false)
			a.settings.AutoGenerateTitles = true
			engine := &fakeTextEngine{output: "Automatic title", started: make(chan textCall, 1), release: make(chan struct{})}
			a.textEngine = engine
			if err := a.StartRecording(); err != nil {
				t.Fatal(err)
			}
			if err := a.StopRecording(); err != nil {
				t.Fatal(err)
			}
			select {
			case <-engine.started:
			case <-time.After(5 * time.Second):
				t.Fatal("automatic title did not start")
			}
			want := ""
			if cancel {
				a.CancelBulkTextQueue()
			} else {
				want = "Manual title"
				if err := a.RenameSession(a.id, want); err != nil {
					t.Fatal(err)
				}
				close(engine.release)
			}
			a.wg.Wait()
			entry, err := a.store.Session(a.id)
			if err != nil || entry.Title != want || entry.FinalTranscript != "A private thought." {
				t.Fatal("manual title or speech lost", entry, err)
			}
		})
	}
}
