package storage

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestPermanentDeletionResultReportsPartialCleanup(t *testing.T) {
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
	result, err := s.PermanentlyDeleteSessionsWithResult(ids)
	if err != nil || result.Error == "" || !reflect.DeepEqual(result.DeletedIDs, []string{"one"}) {
		t.Fatal("partial deletion receipt", result, err)
	}
	if page, err := s.SearchRecentlyDeleted("", 0); err != nil || page.Total != 1 || page.Entries[0].ID != "two" {
		t.Fatal("failed row was not preserved", page, err)
	}
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	result, err = s.PermanentlyDeleteSessionsWithResult(ids)
	if err != nil || result.Error != "" || !reflect.DeepEqual(result.DeletedIDs, ids) {
		t.Fatal("retry must acknowledge both absent identities", result, err)
	}
}

func TestPermanentDeletionResultAcknowledgesCommittedRowAfterCleanupError(t *testing.T) {
	s := backupStore(t)
	audio := filepath.Join(s.Dir, "recordings", "one.wav")
	if err := os.WriteFile(audio, []byte("audio"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.Add(NewSession("one", 1000, "one", "base", "en", audio)); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashSessions([]string{"one"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	// Inject a cleanup-journal fault after the row deletion, without preventing
	// its transaction or the audio staging rename from committing.
	if _, err := s.db.Exec(`CREATE TRIGGER corrupt_cleanup AFTER DELETE ON recordings
		BEGIN UPDATE pending_audio_deletions SET staged='invalid' WHERE id=old.id; END`); err != nil {
		t.Fatal(err)
	}
	result, err := s.PermanentlyDeleteSessionsWithResult([]string{"one"})
	if err != nil || result.Error == "" || !reflect.DeepEqual(result.DeletedIDs, []string{"one"}) {
		t.Fatal("committed deletion was hidden by cleanup error", result, err)
	}
}

func TestPermanentDeletionResultPreservesActiveSession(t *testing.T) {
	s := backupStore(t)
	if err := s.Add(NewSession("active", 1000, "active", "base", "en", "")); err != nil {
		t.Fatal(err)
	}
	result, err := s.PermanentlyDeleteSessionsWithResult([]string{"active"})
	if err != nil || result.Error == "" || len(result.DeletedIDs) != 0 {
		t.Fatal("active row acknowledged as removed", result, err)
	}
	if _, err := s.Session("active"); err != nil {
		t.Fatal("active row lost", err)
	}
}
