package dictionary

import (
	"reflect"
	"testing"

	"yap/internal/storage"
	"yap/internal/vocabulary"
)

func TestCorrectionMergeDoesNotMutateCurrentTermsWhenSaveIsRejected(t *testing.T) {
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	current := []vocabulary.Entry{{ID: "yap", Canonical: "Yap", Aliases: []string{"yapp"}, Enabled: false}}
	if _, err := Save(store, current); err != nil {
		t.Fatal(err)
	}
	merged := Merge(current, "yap", []string{" YAPP ", "Yap", "yup"})
	if merged[0].ID != "yap" || !merged[0].Enabled || !reflect.DeepEqual(merged[0].Aliases, []string{"yapp", "yup"}) {
		t.Fatalf("repeated correction lost identity or alias rules: %+v", merged)
	}
	merged = append(merged, vocabulary.Entry{ID: "conflict", Canonical: "yup", Enabled: true})
	if _, err := Save(store, merged); err == nil {
		t.Fatal("conflicting correction was persisted")
	}
	if current[0].Canonical != "Yap" || current[0].Enabled || !reflect.DeepEqual(current[0].Aliases, []string{"yapp"}) {
		t.Fatal("rejected correction mutated the current library", current)
	}
	saved, err := store.Vocabulary()
	if err != nil || !reflect.DeepEqual(current, saved) {
		t.Fatal("rejected correction changed storage", saved, err)
	}
}
