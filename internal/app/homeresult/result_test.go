package homeresult

import (
	"errors"
	"testing"

	"yap/internal/storage"
)

func resultStore(t *testing.T) *storage.Store {
	t.Helper()
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestResolutionUsesCurrentSavedTextAndRejectsObsoleteRevision(t *testing.T) {
	store := resultStore(t)
	entry := storage.NewSession("saved", 1000, "Original recognition.", "tiny", "en", "")
	if err := store.Add(entry); err != nil {
		t.Fatal(err)
	}
	result, err := Resolve(store, &HomeResult{Session: entry, Saved: true, Text: "Removed output", OutputID: "missing", Outcomes: HomeOutcomes{Clipboard: "complete"}}, false)
	if err != nil || result.Text != entry.FinalTranscript || result.OutputID != "" || result.Outcomes.Clipboard != "skipped" {
		t.Fatalf("missing output did not fall back to the saved transcript: %+v, %v", result, err)
	}
	oldRevision := result.Revision
	if err := store.UpdateTranscript(entry.ID, "Reviewed correction."); err != nil {
		t.Fatal(err)
	}
	result, err = Resolve(store, result, false)
	if err != nil || result.Text != "Reviewed correction." || result.Session.RawTranscript != "Original recognition." {
		t.Fatalf("source refresh lost the current text or recognition: %+v, %v", result, err)
	}
	if err := Validate(result, entry.ID, oldRevision); err == nil {
		t.Fatal("an obsolete action revision was accepted")
	}
	if err := Validate(result, entry.ID, result.Revision); err != nil {
		t.Fatal(err)
	}
}

func TestFailedClipboardRetryAndExplicitSavePreserveTemporaryText(t *testing.T) {
	store := resultStore(t)
	entry := storage.NewSession("temporary", 1000, "Literal recognition.", "tiny", "en", "")
	entry.FinalTranscript = "Reviewed text."
	result := &HomeResult{Session: entry, Text: entry.FinalTranscript, Outputs: []storage.GeneratedOutput{}}
	outcome, err := Apply(store, result, "copy", "", 0, func(string) error { return errors.New("clipboard unavailable") })
	if err == nil || !outcome.PublishOnError || result.Outcomes.Clipboard != "failed" || result.Text != "Reviewed text." {
		t.Fatalf("failed copy lost the retryable result: %+v, %+v, %v", result, outcome, err)
	}
	outcome, err = Apply(store, result, "save", "", 0, nil)
	if err != nil || !outcome.HistoryCleanup || outcome.CleanupError != nil || !result.Saved {
		t.Fatalf("explicit save failed: %+v, %v", outcome, err)
	}
	saved, err := store.Session(entry.ID)
	if err != nil || saved.RawTranscript != "Literal recognition." || saved.FinalTranscript != "Reviewed text." {
		t.Fatalf("saved result changed its source: %+v, %v", saved, err)
	}
}
