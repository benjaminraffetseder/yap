package main

import (
	"testing"

	"yap/internal/storage"
)

func TestDeleteAndRestoreSessionsUpdatesHistoryWithoutInterruptingRecording(t *testing.T) {
	a := testApp(t)
	entry := storage.NewSession("one", 1000, "raw", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.id, a.status.Phase, a.status.Transcript = entry.ID, "done", "raw"
	if err := a.DeleteSession(entry.ID); err != nil {
		t.Fatal(err)
	}
	if a.status.Transcript != "" {
		t.Fatal("deleted transcript remains in completion status")
	}
	if got, err := a.GetSession(entry.ID); err != nil || got != nil {
		t.Fatal("deleted entry remains accessible", got, err)
	}
	if page, err := a.GetRecentlyDeleted("RAW", 0); err != nil || page.Total != 1 || page.Entries[0].DeletedAt == "" {
		t.Fatal("deleted entry missing from recovery list", page, err)
	}
	a.status.Phase = "recording"
	before := a.status
	if err := a.RestoreSessions([]string{entry.ID}); err != nil || a.status != before {
		t.Fatal("restoring history interrupted recording", err)
	}
	if got, err := a.GetSession(entry.ID); err != nil || got == nil || *got != entry {
		t.Fatal("restored session changed", got, err)
	}
	if page, err := a.GetHistory("", 0); err != nil || page.Total != 1 {
		t.Fatal("restored session missing from history", page, err)
	}
	a.status.Phase = "transcribing"
	if err := a.DeleteSession(entry.ID); err == nil {
		t.Fatal("deleted a dictation still being transcribed")
	}
	a.closing = true
	if _, err := a.GetRecentlyDeleted("", 0); err == nil {
		t.Fatal("recovery list allowed during shutdown")
	}
	if err := a.RestoreSessions([]string{entry.ID}); err == nil {
		t.Fatal("restore allowed during shutdown")
	}
}

func TestPermanentDeletionRequiresRecentlyDeletedAndAnAvailableDatabase(t *testing.T) {
	if err := (&App{}).PermanentlyDeleteSessions([]string{"one"}); err == nil {
		t.Fatal("permanent deletion accepted without a database")
	}
	a := testApp(t)
	entry := storage.NewSession("one", 1000, "keep until deleted", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	if err := a.PermanentlyDeleteSessions([]string{entry.ID}); err == nil {
		t.Fatal("active history permanently deleted")
	}
	if err := a.DeleteSession(entry.ID); err != nil {
		t.Fatal(err)
	}
	a.closing = true
	if err := a.PermanentlyDeleteSessions([]string{entry.ID}); err == nil {
		t.Fatal("permanent deletion accepted during shutdown")
	}
	a.closing = false
	a.status.Phase = "recording"
	before := a.status
	if err := a.PermanentlyDeleteSessions([]string{entry.ID}); err != nil || a.status != before {
		t.Fatal("permanent deletion failed or interrupted recording", err)
	}
	if page, err := a.GetRecentlyDeleted("", 0); err != nil || page.Total != 0 {
		t.Fatal("permanently deleted entry still listed", page, err)
	}
	if err := a.RestoreSessions([]string{entry.ID}); err == nil {
		t.Fatal("permanently deleted entry restored")
	}
}
