package main

import (
	"testing"
	"yap/internal/storage"
)

func TestEditingRefreshesHistoryAndLatestResultWithoutCopying(t *testing.T) {
	a := testApp(t)
	v := storage.NewSession("one", 1000, "original", "tiny", "en", "")
	if err := a.store.Add(v); err != nil {
		t.Fatal(err)
	}
	a.id = v.ID
	a.status.Phase, a.status.Transcript = "done", v.RawTranscript
	a.copyText = func(string) error { t.Error("saving edit changed clipboard"); return nil }
	historyEvents := 0
	a.notify = func(topic string, _ ...interface{}) {
		if topic == "dictation:history" {
			historyEvents++
		}
	}
	if err := a.SaveTranscript(v.ID, "Corrected."); err != nil {
		t.Fatal(err)
	}
	snap, err := a.GetSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.History) != 1 || snap.History[0].FinalTranscript != "Corrected." || snap.History[0].RawTranscript != v.RawTranscript {
		t.Fatal("saved edit missing from snapshot")
	}
	if snap.Status.Transcript != "Corrected." || snap.Status.Message != "Transcript updated in History" || historyEvents != 1 {
		t.Fatal("latest result or history event not updated")
	}
	if err := a.SaveTranscript(v.ID, ""); err == nil || historyEvents != 1 {
		t.Fatal("failed edit emitted success event")
	}
}

func TestEditingAnOlderEntryDoesNotInterruptRecording(t *testing.T) {
	a := testApp(t)
	v := storage.NewSession("old", 1000, "old original", "tiny", "en", "")
	if err := a.store.Add(v); err != nil {
		t.Fatal(err)
	}
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	before := a.status
	if err := a.SaveTranscript(v.ID, "Old correction."); err != nil {
		t.Fatal(err)
	}
	if a.status != before {
		t.Fatal("editing history interrupted recording")
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	a.closing = true
	if err := a.SaveTranscript(v.ID, "after shutdown"); err == nil {
		t.Fatal("edit accepted during shutdown")
	}
	a.closing = false
}
