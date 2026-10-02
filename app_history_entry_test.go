package main

import (
	"fmt"
	"testing"

	"yap/internal/storage"
)

func TestGetSessionLoadsAnOlderResultOutsideRecentHistory(t *testing.T) {
	a := testApp(t)
	old := storage.NewSession("older", 17000, "original speech", "base", "de", "")
	old.CreatedAt = "2000-01-01T00:00:00Z"
	if err := a.store.Add(old); err != nil {
		t.Fatal(err)
	}
	if err := a.store.UpdateTranscript(old.ID, "saved result"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 500; i++ {
		if err := a.store.Add(storage.NewSession(fmt.Sprintf("new-%d", i), 1000, "new", "tiny", "en", "")); err != nil {
			t.Fatal(err)
		}
	}
	recent, err := a.store.History()
	if err != nil || len(recent) != 500 {
		t.Fatalf("recent history: %d, %v", len(recent), err)
	}
	for _, entry := range recent {
		if entry.ID == old.ID {
			t.Fatal("fixture must be outside recent history")
		}
	}
	entry, err := a.GetSession(old.ID)
	if err != nil || entry == nil {
		t.Fatalf("load older entry: %v, %v", entry, err)
	}
	if entry.RawTranscript != old.RawTranscript || entry.FinalTranscript != "saved result" || entry.Language != old.Language || entry.DurationMS != old.DurationMS {
		t.Fatalf("incorrect entry: %+v", entry)
	}
	if _, err := a.store.DeleteSessions([]string{old.ID}); err != nil {
		t.Fatal(err)
	}
	if entry, err := a.GetSession(old.ID); err != nil || entry != nil {
		t.Fatalf("deleted entry: %v, %v", entry, err)
	}
}

func TestGetSessionGuardsUnavailableDatabase(t *testing.T) {
	if _, err := (&App{}).GetSession("missing"); err == nil {
		t.Fatal("missing database accepted")
	}
	a := testApp(t)
	a.closing = true
	if _, err := a.GetSession("missing"); err == nil {
		t.Fatal("lookup allowed during shutdown")
	}
}
