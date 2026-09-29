package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yap/internal/storage"
)

func TestRetentionSettingsAreExplicitAndDoNotDeleteOnFailedSave(t *testing.T) {
	a := testApp(t)
	v := storage.NewSession("old", 1000, "raw", "tiny", "en", "")
	v.CreatedAt = time.Now().Add(-100 * 24 * time.Hour).Format(time.RFC3339Nano)
	if err := a.store.Add(v); err != nil {
		t.Fatal(err)
	}
	next := a.settings
	next.HistoryRetentionDays = -1
	if err := a.SaveSettings(next); err == nil {
		t.Fatal("invalid retention accepted")
	}
	if _, err := a.store.Session(v.ID); err != nil {
		t.Fatal("failed validation removed History")
	}
	next.HistoryRetentionDays = 7
	a.status.Phase = "recording"
	if err := a.SaveSettings(next); err == nil {
		t.Fatal("retention changed during capture")
	}
	a.status.Phase = "done"
	a.id = v.ID
	a.status.Transcript = "raw"
	if err := a.SaveSettings(next); err != nil {
		t.Fatal(err)
	}
	page, err := a.GetHistory("", 0)
	if err != nil || page.Total != 0 || a.status.Transcript != "" {
		t.Fatal("expired dictation survived settings cleanup")
	}
	loaded, err := a.store.Settings()
	if err != nil || loaded.HistoryRetentionDays != 7 {
		t.Fatal("retention not saved")
	}
}

func TestRetentionFailureKeepsDictationSuccessAndReportsRecovery(t *testing.T) {
	a := testApp(t)
	path := filepath.Join(a.store.Dir, "recordings", "blocked.wav")
	os.Mkdir(path, 0700)
	v := storage.NewSession("old", 1000, "old", "tiny", "en", path)
	v.CreatedAt = time.Now().Add(-8 * 24 * time.Hour).Format(time.RFC3339Nano)
	if err := a.store.Add(v); err != nil {
		t.Fatal(err)
	}
	a.settings.HistoryRetentionDays = 7
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if a.status.Phase != "done" || a.status.HistoryError == "" {
		t.Fatal("cleanup failure hid success or recovery message")
	}
	if _, err := a.store.Session(v.ID); err != nil {
		t.Fatal("failed audio cleanup removed dictation")
	}
	os.Remove(path)
	a.pruneHistoryLocked()
	if a.status.HistoryError != "" {
		t.Fatal("successful retry did not clear warning")
	}
}

func TestManagementGuardsAndExportCorrections(t *testing.T) {
	a := testApp(t)
	model := filepath.Join(a.store.Dir, "models", "ggml-tiny.bin")
	os.WriteFile(model, []byte("model"), 0600)
	for _, phase := range []string{"recording", "transcribing", "downloading", "mic-test", "diagnostic-recording", "diagnostic-transcribing"} {
		a.status.Phase = phase
		if err := a.RemoveModel("tiny"); err == nil {
			t.Errorf("removed model during %s", phase)
		}
	}
	a.status.Phase = "idle"
	a.settings.ModelPath = model
	if err := a.RemoveModel("tiny"); err == nil {
		t.Fatal("active model removed")
	}
	a.settings.ModelPath = "custom-model"
	if err := a.RemoveModel("tiny"); err != nil {
		t.Fatal(err)
	}
	v := storage.NewSession("one", 1000, "original", "base", "en", "")
	v.FinalTranscript = "Edited final."
	if err := a.store.Add(v); err != nil {
		t.Fatal(err)
	}
	entries, err := a.store.SelectedSessions([]string{v.ID})
	if err != nil {
		t.Fatal(err)
	}
	text := formatHistoryExport(entries)
	if !strings.Contains(text, "Edited final.") || strings.Contains(text, "original") || !strings.Contains(text, v.CreatedAt) {
		t.Fatal("export lost corrections or recording metadata")
	}
	a.status.Phase = "recording"
	before := a.status
	if err := a.DeleteSessions([]string{v.ID}); err != nil || a.status != before {
		t.Fatal("deleting History interrupted recording")
	}
	a.closing = true
	if _, err := a.GetHistory("", 0); err == nil {
		t.Fatal("query during shutdown")
	}
	if err := a.RemoveModel("tiny"); err == nil {
		t.Fatal("model removal during shutdown")
	}
	if err := a.DeleteSessions([]string{"one"}); err == nil {
		t.Fatal("delete during shutdown")
	}
	a.closing = false
}
