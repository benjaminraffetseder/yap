package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yap/internal/storage"
)

func recordTemporary(t *testing.T, a *App) string {
	t.Helper()
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	path := a.path
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	return path
}
func TestTemporaryDictationDoesNotPersistAndCanBeSaved(t *testing.T) {
	a := testApp(t)
	a.settings.SaveAudio = true
	if err := a.SetSaveHistory(false); err != nil {
		t.Fatal(err)
	}
	saved, err := a.store.Settings()
	if err != nil || saved.SaveHistory {
		t.Fatal("preference not persisted", err)
	}
	var copied string
	a.copyText = func(text string) error { copied = text; return errors.New("clipboard unavailable") }
	path := recordTemporary(t, a)
	history, err := a.store.History()
	if err != nil || len(history) != 0 {
		t.Fatal("unsaved dictation entered history", history, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("unsaved audio retained", err)
	}
	if a.latestResult == nil || a.latestResult.Text != copied || a.latestResult.Session.AudioPath != "" {
		t.Fatal("missing recovery result")
	}
	id := a.latestResult.Session.ID
	if err := a.SaveLatestResult("stale"); err == nil {
		t.Fatal("saved stale result")
	}
	if err := a.SaveLatestResult(id); err != nil {
		t.Fatal(err)
	}
	history, _ = a.store.History()
	if len(history) != 1 || history[0].ID != id || a.latestResult != nil {
		t.Fatal("manual save failed")
	}
	if a.settings.SaveHistory {
		t.Fatal("manual save changed preference")
	}
	if err := a.SaveLatestResult(id); err == nil {
		t.Fatal("duplicate save accepted")
	}
}
func TestTemporaryResultLifecycleAndCapturedPreference(t *testing.T) {
	a := testApp(t)
	a.SetSaveHistory(false)
	recordTemporary(t, a)
	oldID := a.latestResult.Session.ID
	snapshot, err := a.GetSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	snapshot.LatestResult.Text = "modified by caller"
	if a.latestResult.Text == snapshot.LatestResult.Text {
		t.Fatal("snapshot shares mutable result")
	}
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if a.latestResult != nil {
		t.Fatal("previous result survived next recording")
	}
	if err := a.SetSaveHistory(true); err != nil {
		t.Fatal(err)
	}
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	history, _ := a.store.History()
	if len(history) != 0 || a.latestResult == nil {
		t.Fatal("preference changed in-flight recording")
	}
	if err := a.DismissLatestResult(oldID); err == nil {
		t.Fatal("stale dismiss accepted")
	}
	if err := a.DismissLatestResult(a.latestResult.Session.ID); err != nil {
		t.Fatal(err)
	}
	if a.latestResult != nil || a.status.Transcript != "" {
		t.Fatal("dismiss retained text")
	}
	recordTemporary(t, a)
	history, _ = a.store.History()
	if len(history) != 1 || a.latestResult != nil {
		t.Fatal("next recording did not use new preference")
	}
	a.toggleHistory()
	if a.settings.SaveHistory {
		t.Fatal("tray did not toggle")
	}
}
func TestTemporaryAutomaticProcessingRecovery(t *testing.T) {
	for _, mode := range []string{"success", "failure", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			a := testApp(t)
			enableText(t, a, true)
			a.SetSaveHistory(false)
			fake := &fakeTextEngine{output: "Processed result."}
			if mode == "failure" {
				fake.err = errors.New("model unavailable")
			}
			if mode == "cancel" {
				fake.started = make(chan textCall, 1)
				fake.release = make(chan struct{})
			}
			a.textEngine = fake
			copied := ""
			a.copyText = func(text string) error { copied = text; return nil }
			if err := a.StartRecording(); err != nil {
				t.Fatal(err)
			}
			if err := a.StopRecording(); err != nil {
				t.Fatal(err)
			}
			if mode == "cancel" {
				<-fake.started
				a.Cancel()
			}
			a.wg.Wait()
			history, _ := a.store.History()
			if len(history) != 0 || a.latestResult == nil {
				t.Fatal("temporary processing persisted or lost transcript")
			}
			if mode == "success" {
				if copied != fake.output || a.latestResult.Output == nil {
					t.Fatal("processing not delivered")
				}
				id := a.latestResult.Session.ID
				if err := a.SaveLatestResult(id); err != nil {
					t.Fatal(err)
				}
				outputs, err := a.store.GeneratedOutputs(id)
				if err != nil || len(outputs) != 1 || outputs[0].Text != fake.output {
					t.Fatal("manual save lost generated output", err)
				}
			} else {
				if copied != "" || a.latestResult.Output != nil || strings.Contains(a.status.Message, "saved to History") {
					t.Fatal("incorrect failure recovery")
				}
			}
		})
	}
}
func TestTemporaryResultExcludedFromBackupAndShutdown(t *testing.T) {
	a := testApp(t)
	a.SetSaveHistory(false)
	recordTemporary(t, a)
	if a.latestResult == nil {
		t.Fatal("missing temporary result")
	}
	summary, err := a.store.ExportBackup(context.Background(), filepath.Join(t.TempDir(), "backup.zip"), true)
	if err != nil || summary.Sessions != 0 || summary.Outputs != 0 || summary.Recordings != 0 {
		t.Fatal("temporary result entered backup", summary, err)
	}
	a.shutdown(context.Background())
	if a.latestResult != nil || a.status.Transcript != "" {
		t.Fatal("shutdown retained temporary text")
	}
	reopened, err := storage.Open(a.store.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	history, err := reopened.History()
	if err != nil || len(history) != 0 {
		t.Fatal("temporary result persisted across restart", err)
	}
}

func TestTemporaryAudioImport(t *testing.T) {
	a := testApp(t)
	a.SetSaveHistory(false)
	a.settings.SaveAudio = true
	a.engine = importedSpeech{}
	source := importedWAV(t)
	before, _ := os.ReadFile(source)
	if err := a.importAudio(source); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	history, _ := a.store.History()
	if len(history) != 0 || a.latestResult == nil || a.latestResult.Session.AudioPath != "" {
		t.Fatal("import persisted instead of being temporary")
	}
	if _, err := os.Stat(a.path); !os.IsNotExist(err) {
		t.Fatal("import retained temporary audio")
	}
	after, _ := os.ReadFile(source)
	if string(before) != string(after) {
		t.Fatal("source file changed")
	}
}
