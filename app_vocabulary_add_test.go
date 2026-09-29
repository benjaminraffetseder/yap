package main

import (
	"fmt"
	"reflect"
	"sync"
	"testing"

	"yap/internal/storage"
	"yap/internal/vocabulary"
)

func TestAddVocabularyPreservesExistingTermsAndTranscripts(t *testing.T) {
	a := testApp(t)
	old := []vocabulary.Entry{{ID: "existing", Canonical: "SQLite", Aliases: []string{"sequel lite"}, Enabled: false}}
	if _, err := a.SaveVocabulary(old); err != nil {
		t.Fatal(err)
	}
	session := storage.NewSession("old", 1000, "private", "tiny", "en", "")
	if err := a.store.Add(session); err != nil {
		t.Fatal(err)
	}
	before := a.status
	a.copyText = func(string) error { t.Error("adding vocabulary changed clipboard"); return nil }
	a.diagnostic = DiagnosticResult{Phase: "done", Transcript: "old test"}
	events := 0
	a.notify = func(topic string, _ ...interface{}) {
		if topic == "setup:changed" {
			events++
		}
	}
	entries, err := a.AddVocabularyTerm(" Yap ", []string{" private ", "PRIVATE"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || !reflect.DeepEqual(entries[0], old[0]) || entries[1].Canonical != "Yap" || !entries[1].Enabled || !reflect.DeepEqual(entries[1].Aliases, []string{"private"}) || entries[1].ID == "" {
		t.Fatalf("invalid appended vocabulary: %+v", entries)
	}
	if a.status != before || a.diagnostic != (DiagnosticResult{}) || events != 1 {
		t.Fatal("add changed recording status or failed to invalidate diagnostics/refresh vocabulary")
	}
	got, err := a.store.Session(session.ID)
	if err != nil || got != session {
		t.Fatalf("add reprocessed history: %+v, %v", got, err)
	}
	reopened, err := storage.Open(a.store.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, err := reopened.Vocabulary()
	if err != nil || !reflect.DeepEqual(entries, persisted) {
		t.Fatal("vocabulary did not persist")
	}

	// The existing dictation pipeline uses the confirmed alias next time.
	a.copyText = func(string) error { return nil }
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	latest, err := a.store.Session(a.id)
	if err != nil || latest.RawTranscript != "A private thought." || latest.FinalTranscript != "A Yap thought." {
		t.Fatalf("new term not applied to future dictation: %+v, %v", latest, err)
	}
}

func TestConcurrentVocabularyAddsKeepBothTerms(t *testing.T) {
	a := testApp(t)
	var wg sync.WaitGroup
	for _, term := range []string{"Yap", "PostgreSQL"} {
		wg.Add(1)
		go func(term string) {
			defer wg.Done()
			if _, err := a.AddVocabularyTerm(term, nil); err != nil {
				t.Error(err)
			}
		}(term)
	}
	wg.Wait()
	if len(a.vocabulary) != 2 {
		t.Fatal("concurrent add lost a term")
	}
}

func TestInvalidVocabularyAddsLeaveSavedStateIntact(t *testing.T) {
	a := testApp(t)
	if _, err := a.SaveVocabulary([]vocabulary.Entry{{ID: "one", Canonical: "Yap", Aliases: []string{"yapp"}, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	before, _ := a.store.Vocabulary()
	for _, test := range []struct {
		canonical string
		aliases   []string
	}{
		{"YAP", nil}, {"Other", []string{"yapp"}}, {" ", nil}, {"line\nbreak", nil}, {"Other", make([]string, 11)},
	} {
		if _, err := a.AddVocabularyTerm(test.canonical, test.aliases); err == nil {
			t.Errorf("accepted invalid term: %+v", test)
		}
	}
	for _, phase := range []string{"recording", "transcribing", "downloading", "mic-test", "diagnostic-recording", "diagnostic-transcribing"} {
		a.status.Phase = phase
		if _, err := a.AddVocabularyTerm("Other", nil); err == nil {
			t.Errorf("add allowed during %s", phase)
		}
	}
	a.status.Phase = "idle"
	a.closing = true
	if _, err := a.AddVocabularyTerm("Other", nil); err == nil {
		t.Error("add allowed during shutdown")
	}
	a.closing = false
	after, _ := a.store.Vocabulary()
	if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(before, a.vocabulary) {
		t.Fatal("failed add changed vocabulary")
	}

	full := make([]vocabulary.Entry, 100)
	for i := range full {
		full[i] = vocabulary.Entry{ID: fmt.Sprint(i), Canonical: fmt.Sprintf("term%d", i), Enabled: true}
	}
	if _, err := a.SaveVocabulary(full); err != nil {
		t.Fatal(err)
	}
	if _, err := a.AddVocabularyTerm("Extra", nil); err == nil || len(a.vocabulary) != 100 {
		t.Fatal("add exceeded vocabulary limit")
	}
}

func TestVocabularyAddWriteFailureDoesNotPublishSuccess(t *testing.T) {
	a := testApp(t)
	a.diagnostic = DiagnosticResult{Phase: "done"}
	a.notify = func(string, ...interface{}) { t.Error("failed write emitted success event") }
	if err := a.store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.AddVocabularyTerm("Yap", nil); err == nil {
		t.Fatal("closed database accepted write")
	}
	if len(a.vocabulary) != 0 || a.diagnostic.Phase != "done" {
		t.Fatal("failed write changed in-memory state")
	}
}
