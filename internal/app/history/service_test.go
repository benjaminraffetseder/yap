package history

import (
	"testing"

	"yap/internal/storage"
)

func TestCurrentDictationCannotBeEditedOrTrashedUntilItFinishes(t *testing.T) {
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	entry := storage.NewSession("current", 1000, "Literal recognition", "tiny", "en", "")
	if err := store.Add(entry); err != nil {
		t.Fatal(err)
	}
	current := Current{ID: entry.ID, Phase: "transcribing"}
	if _, err := Edit(store, current, entry.ID, "New text"); err == nil {
		t.Fatal("edited a transcription in progress")
	}
	if change, err := Trash(store, current, []string{entry.ID}); err == nil || change.Refresh || change.Changed {
		t.Fatalf("rejected deletion published a change: %+v, %v", change, err)
	}
	saved, err := store.Session(entry.ID)
	if err != nil || saved.FinalTranscript != entry.FinalTranscript {
		t.Fatal("rejected changes modified the saved source", saved, err)
	}
	current.Phase = "done"
	change, err := Edit(store, current, entry.ID, "Reviewed text")
	if err != nil || !change.Changed || change.Text != "Reviewed text" {
		t.Fatalf("completed transcript could not be edited: %+v, %v", change, err)
	}
	change, err = Trash(store, current, []string{entry.ID})
	if err != nil || !change.Changed || !change.Refresh || change.Text != "" {
		t.Fatalf("completed transcript could not be removed: %+v, %v", change, err)
	}
	if entry, err := Session(store, current.ID); err != nil || entry != nil {
		t.Fatal("removed transcript remained visible", entry, err)
	}
}
