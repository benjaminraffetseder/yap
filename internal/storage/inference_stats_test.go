package storage

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
)

func TestInferenceStatsSurviveHistoryBackupAndDeletion(t *testing.T) {
	s := backupStore(t)
	entry := NewSession("stats-recording", 10000, "Transcript", "tiny", "auto", "")
	entry.Stats = &SpeechStats{TranscriptionMS: 500, Engine: "whisper"}
	config := textmodel.Defaults()
	config.Model = "local"
	output := NewGeneratedOutput(entry.ID, entry.RawTranscript, "Summary", config, config.Prompts[0])
	output.Stats = &textmodel.Stats{DurationMS: 1000, ResponseMS: 900, Attempts: 2, Model: "actual-model", OutputTokens: new(50)}
	if err := s.AddWithOutput(entry, &output); err != nil {
		t.Fatal(err)
	}
	check := func(store *Store) {
		t.Helper()
		got, err := store.Session(entry.ID)
		if err != nil || !reflect.DeepEqual(got, entry) {
			t.Fatal("session metadata changed", got, err)
		}
		history, err := store.History()
		if err != nil || len(history) != 1 || !reflect.DeepEqual(history[0], entry) {
			t.Fatal("Home history lost stats", history, err)
		}
		page, err := store.SearchHistory("Transcript", 0)
		if err != nil || len(page.Entries) != 1 || !reflect.DeepEqual(page.Entries[0], entry) {
			t.Fatal("paged history lost stats", page, err)
		}
		outputs, err := store.GeneratedOutputs(entry.ID)
		if err != nil || len(outputs) != 1 || !reflect.DeepEqual(outputs[0], output) {
			t.Fatal("output metadata changed", outputs, err)
		}
	}
	check(s)
	path := filepath.Join(t.TempDir(), "stats.zip")
	if _, err := s.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	if _, err := dest.RestoreBackup(context.Background(), archive, false); err != nil {
		t.Fatal(err)
	}
	check(dest)
	if err := dest.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	deleted, err := dest.SearchRecentlyDeleted("", 0)
	if err != nil || len(deleted.Entries) != 1 || !reflect.DeepEqual(deleted.Entries[0].Stats, entry.Stats) {
		t.Fatal("soft deletion lost stats", deleted, err)
	}
	if err := dest.Delete(entry.ID); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := dest.db.QueryRow("SELECT COUNT(*) FROM inference_stats").Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("permanent deletion retained inference stats", remaining, err)
	}
}

func TestStatsSettingDefaultsOffAndPersists(t *testing.T) {
	s := backupStore(t)
	settings, err := s.Settings()
	if err != nil || settings.StatsForNerds {
		t.Fatal("stats enabled by default", settings, err)
	}
	settings.StatsForNerds = true
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	saved, err := reopened.Settings()
	if err != nil || !saved.StatsForNerds {
		t.Fatal("setting did not persist", saved, err)
	}
	// Older settings and recordings remain readable without synthetic timings.
	if _, err := s.db.Exec(`UPDATE settings SET value='{"language":"auto"}'`); err != nil {
		t.Fatal(err)
	}
	legacy, err := s.Settings()
	if err != nil || legacy.StatsForNerds {
		t.Fatal("legacy setting default changed", legacy, err)
	}
	entry := NewSession("legacy", 1000, "Old transcript", "tiny", "en", "")
	if err := s.Add(entry); err != nil {
		t.Fatal(err)
	}
	got, err := s.Session(entry.ID)
	if err != nil || got.Stats != nil {
		t.Fatal("legacy transcript acquired invented timing", got, err)
	}
}
