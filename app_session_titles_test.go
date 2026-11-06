package main

import (
	"strings"
	"testing"
	"time"

	"yap/internal/storage"
)

func TestRenameSessionPreservesRecordingStateAndText(t *testing.T) {
	a := testApp(t)
	entry := storage.NewSession("saved", 1000, "literal original", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.id, a.status.Phase, a.status.Transcript = "current-capture", "recording", "untouched"
	before := a.status
	if err := a.RenameSession(entry.ID, "Planning notes"); err != nil {
		t.Fatal(err)
	}
	got, err := a.GetSession(entry.ID)
	if err != nil || got == nil || got.Title != "Planning notes" {
		t.Fatal("rename not readable", got, err)
	}
	got.Title = ""
	if *got != entry || a.status != before || a.id != "current-capture" {
		t.Fatal("rename mutated capture or transcript")
	}
	page, err := a.GetHistory("Planning", 0)
	if err != nil || page.Total != 1 {
		t.Fatal("renamed dictation not searchable", page, err)
	}
	if !strings.HasPrefix(exportTranscriptText(page.Entries[0], "text"), "Planning notes\n") {
		t.Fatal("export lost title")
	}
	if err := a.store.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := a.RenameSession(entry.ID, "must fail"); err == nil {
		t.Fatal("deleted recording renamed")
	}
	a.closing = true
	if err := a.RenameSession(entry.ID, "closed"); err == nil {
		t.Fatal("rename during closing")
	}
	if err := (&App{}).RenameSession("missing", "no database"); err == nil {
		t.Fatal("rename without storage")
	}
}
