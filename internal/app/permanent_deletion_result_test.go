package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
	"yap/internal/storage"
)

func TestPermanentDeletionReceiptSurvivesPartialFailure(t *testing.T) {
	a := testApp(t)
	blocked := filepath.Join(a.store.Dir, "recordings", "blocked.wav")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []storage.Session{
		storage.NewSession("one", 1000, "one", "base", "en", ""),
		storage.NewSession("two", 1000, "two", "base", "en", blocked),
	} {
		if err := a.store.Add(entry); err != nil {
			t.Fatal(err)
		}
	}
	ids := []string{"one", "two"}
	if err := a.store.TrashSessions(ids, time.Now()); err != nil {
		t.Fatal(err)
	}
	result, err := a.PermanentlyDeleteSessionsWithResult(ids)
	if err != nil || result.Error == "" || !reflect.DeepEqual(result.DeletedIDs, []string{"one"}) {
		t.Fatal("partial outcome did not cross the service boundary", result, err)
	}
}
