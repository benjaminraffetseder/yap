package app

import (
	"fmt"
	"testing"

	"yap/internal/storage"
)

func TestHistorySelectionIDsIncludeUnloadedMatchesAndRetireDeletedOnes(t *testing.T) {
	a := testApp(t)
	for index := 0; index < 65; index++ {
		if err := a.store.Add(storage.NewSession(fmt.Sprintf("selection-%02d", index), 1000, "bulk transcript", "base", "en", "")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.store.DeleteSessions([]string{"selection-00"}); err != nil {
		t.Fatal(err)
	}
	page, err := a.GetHistory("bulk", 0)
	if err != nil || len(page.Entries) != 50 {
		t.Fatalf("first page: %d entries, %v", len(page.Entries), err)
	}
	ids, err := a.GetHistorySelectionIDs("bulk")
	if err != nil || len(ids) != 64 {
		t.Fatalf("complete selection: %d IDs, %v", len(ids), err)
	}
	for _, id := range ids {
		if id == "selection-00" {
			t.Fatal("deleted session remained in the selection")
		}
	}
}

func TestHistorySelectionIDsUseNativeUnicodeSearchAndAvailability(t *testing.T) {
	a := testApp(t)
	if err := a.store.Add(storage.NewSession("unicode-selection", 1000, "istanbul", "base", "en", "")); err != nil {
		t.Fatal(err)
	}
	ids, err := a.GetHistorySelectionIDs("İ")
	if err != nil || len(ids) != 1 || ids[0] != "unicode-selection" {
		t.Fatalf("native Unicode membership: %v, %v", ids, err)
	}
	a.closing = true
	if _, err := a.GetHistorySelectionIDs(""); err == nil {
		t.Fatal("selection read allowed during shutdown")
	}
	if _, err := (&App{}).GetHistorySelectionIDs(""); err == nil {
		t.Fatal("selection read allowed without storage")
	}
}
