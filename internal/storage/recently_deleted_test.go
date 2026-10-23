package storage

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
)

func TestRecentlyDeletedPreservesAndRestoresCompleteDictationAfterReopen(t *testing.T) {
	s := backupStore(t)
	now := time.Now().UTC()
	path := filepath.Join(s.Dir, "recordings", "one.wav")
	if err := os.WriteFile(path, []byte("audio"), 0600); err != nil {
		t.Fatal(err)
	}
	entry := NewSession("one", 1000, "raw", "base", "en", path)
	entry.FinalTranscript = "corrected"
	entry.CreatedAt = now.Add(-90 * 24 * time.Hour).Format(time.RFC3339Nano)
	config := textmodel.Defaults()
	config.Model = "local-model"
	prompt, _ := config.Prompt("summary")
	output := NewGeneratedOutput(entry.ID, entry.FinalTranscript, "summary", config, prompt)
	if err := s.AddWithOutput(entry, &output); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashSessions([]string{entry.ID}, now); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashSessions([]string{entry.ID}, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(s.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.Session(entry.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("deleted dictation accessible as an active session", err)
	}
	if recent, err := s.History(); err != nil || len(recent) != 0 {
		t.Fatal("deleted dictation visible in snapshot", recent, err)
	}
	if page, err := s.SearchHistory("corrected", 0); err != nil || page.Total != 0 {
		t.Fatal("deleted dictation visible in search", page, err)
	}
	if _, err := s.SelectedSessions([]string{entry.ID}); err == nil {
		t.Fatal("deleted dictation exported")
	}
	if err := s.UpdateTranscript(entry.ID, "overwritten"); err == nil {
		t.Fatal("deleted dictation edited")
	}
	if err := s.AddGeneratedOutput(NewGeneratedOutput(entry.ID, "input", "new", config, prompt)); err == nil {
		t.Fatal("output saved to deleted dictation")
	}
	if count, err := s.PruneHistory(7, now.Add(29*24*time.Hour)); err != nil || count != 0 {
		t.Fatal("history retention shortened the recovery window", count, err)
	}
	page, err := s.SearchRecentlyDeleted("CORRECTED", 0)
	if err != nil || page.Total != 1 || page.Entries[0].DeletedAt != now.Format(time.RFC3339Nano) {
		t.Fatal("recovery timestamp or searchable content changed", page, err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := backupSnapshotBounded(context.Background(), tx, 1<<20)
	tx.Rollback()
	if err != nil || len(manifest.Sessions) != 0 || len(manifest.Outputs) != 0 {
		t.Fatal("backup included deleted content", manifest, err)
	}
	if err := s.RestoreSessions([]string{entry.ID}, now.Add(29*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got, err := s.Session(entry.ID); err != nil || got != entry {
		t.Fatal("restoration changed transcription metadata or edits", got, err)
	}
	if got, err := s.GeneratedOutputs(entry.ID); err != nil || !reflect.DeepEqual(got, []GeneratedOutput{output}) {
		t.Fatal("restoration lost outputs", got, err)
	}
	if audio, err := os.ReadFile(path); err != nil || string(audio) != "audio" {
		t.Fatal("restoration lost audio", err)
	}
}

func TestRecentlyDeletedExpiresAfterThirtyDaysAndRetriesAudioCleanup(t *testing.T) {
	s := backupStore(t)
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(s.Dir, "recordings", "blocked.wav")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := s.Add(NewSession("one", 1000, "raw", "base", "en", path)); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashSessions([]string{"one"}, now); err != nil {
		t.Fatal(err)
	}
	expiry := now.Add(30 * 24 * time.Hour)
	if count, err := s.PruneHistory(0, expiry.Add(-time.Nanosecond)); err != nil || count != 0 {
		t.Fatal("deleted before expiry", count, err)
	}
	if err := s.RestoreSessions([]string{"one"}, expiry); err == nil {
		t.Fatal("restored after expiry")
	}
	if count, err := s.PruneHistory(0, expiry); err == nil || count != 0 {
		t.Fatal("audio cleanup failure hidden", count, err)
	}
	if _, err := s.sessionIncludingDeleted("one"); err != nil {
		t.Fatal("cleanup failure removed recoverable metadata", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("audio"), 0600); err != nil {
		t.Fatal(err)
	}
	if count, err := s.PruneHistory(0, expiry); err != nil || count != 1 {
		t.Fatal("expiry retry failed with history retention disabled", count, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("expired audio not removed", err)
	}
	if page, err := s.SearchRecentlyDeleted("", 0); err != nil || page.Total != 0 {
		t.Fatal("expired tombstone remains", page, err)
	}
}

func TestRecentlyDeletedSelectionsAreAtomic(t *testing.T) {
	s := backupStore(t)
	now := time.Now()
	for _, id := range []string{"one", "two"} {
		if err := s.Add(NewSession(id, 1000, id, "base", "en", "")); err != nil {
			t.Fatal(err)
		}
	}
	for _, ids := range [][]string{nil, {"one", "one"}, {"one", "missing"}, {""}} {
		if err := s.TrashSessions(ids, now); err == nil {
			t.Fatal("invalid selection accepted", ids)
		}
		if _, err := s.Session("one"); err != nil {
			t.Fatal("invalid selection partially deleted", err)
		}
	}
	if err := s.TrashSessions([]string{"one", "two"}, now); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreSessions([]string{"one", "missing"}, now); err == nil {
		t.Fatal("invalid restore accepted")
	}
	if page, err := s.SearchRecentlyDeleted("", 0); err != nil || page.Total != 2 {
		t.Fatal("restore partially committed", page, err)
	}
}

func TestPermanentDeletionOnlyRemovesTrashedDictationsAndAllTheirContent(t *testing.T) {
	s := backupStore(t)
	path := filepath.Join(s.Dir, "recordings", "deleted.wav")
	if err := os.WriteFile(path, []byte("audio"), 0600); err != nil {
		t.Fatal(err)
	}
	entry := NewSession("deleted", 1000, "original", "base", "en", path)
	entry.FinalTranscript = "corrected"
	config := textmodel.Defaults()
	config.Model = "local-model"
	prompt, _ := config.Prompt("summary")
	output := NewGeneratedOutput(entry.ID, entry.FinalTranscript, "summary", config, prompt)
	if err := s.AddWithOutput(entry, &output); err != nil {
		t.Fatal(err)
	}
	if err := s.Add(NewSession("active", 1000, "keep", "base", "en", "")); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, ids := range [][]string{nil, {"deleted", "deleted"}, {"deleted", "active"}, {""}, make([]string, HistoryPageSize+1)} {
		if count, err := s.PermanentlyDeleteSessions(ids); err == nil || count != 0 {
			t.Fatal("invalid permanent deletion accepted", ids, count, err)
		}
		if _, err := s.sessionIncludingDeleted(entry.ID); err != nil {
			t.Fatal("invalid selection partially deleted", err)
		}
	}
	if count, err := s.PermanentlyDeleteSessions([]string{entry.ID}); err != nil || count != 1 {
		t.Fatal("permanent deletion failed", count, err)
	}
	if _, err := s.sessionIncludingDeleted(entry.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("deleted metadata remains", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("permanently deleted audio remains", err)
	}
	for _, table := range []string{"deleted_recordings", "recording_outputs", "generated_outputs"} {
		var count int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("permanent deletion left related content", table, count, err)
		}
	}
	if err := s.RestoreSessions([]string{entry.ID}, time.Now()); err == nil {
		t.Fatal("permanent deletion could be undone")
	}
	if count, err := s.PermanentlyDeleteSessions([]string{entry.ID}); err != nil || count != 0 {
		t.Fatal("permanent deletion retry failed", count, err)
	}
	if _, err := s.Session("active"); err != nil {
		t.Fatal("permanent deletion affected active history", err)
	}
}

func TestPermanentDeletionRetriesAfterPartialAudioCleanup(t *testing.T) {
	s := backupStore(t)
	blocked := filepath.Join(s.Dir, "recordings", "blocked.wav")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []Session{
		NewSession("one", 1000, "one", "base", "en", ""),
		NewSession("two", 1000, "two", "base", "en", blocked),
	} {
		if err := s.Add(entry); err != nil {
			t.Fatal(err)
		}
	}
	ids := []string{"one", "two"}
	if err := s.TrashSessions(ids, time.Now()); err != nil {
		t.Fatal(err)
	}
	if count, err := s.PermanentlyDeleteSessions(ids); err == nil || count != 1 {
		t.Fatal("partial cleanup failure hidden", count, err)
	}
	if page, err := s.SearchRecentlyDeleted("", 0); err != nil || page.Total != 1 || page.Entries[0].ID != "two" {
		t.Fatal("remaining dictation lost", page, err)
	}
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	if count, err := s.PermanentlyDeleteSessions(ids); err != nil || count != 1 {
		t.Fatal("could not retry a partially deleted selection", count, err)
	}
}
