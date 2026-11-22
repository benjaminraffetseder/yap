package app

import (
	"testing"
	"time"
	"yap/internal/storage"
)

func TestDeletingSavedHomeResultRetiresIdentityAndUsesRemainingHistory(t *testing.T) {
	for _, older := range []bool{false, true} {
		t.Run(map[bool]string{false: "sole result", true: "older result remains"}[older], func(t *testing.T) {
			a := testApp(t)
			if older {
				entry := storage.NewSession("older", 1000, "Older result", "tiny", "en", "")
				entry.CreatedAt = time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
				if err := a.store.Add(entry); err != nil {
					t.Fatal(err)
				}
			}
			entry := storage.NewSession("newest", 1000, "New result", "tiny", "en", "")
			if err := a.store.Add(entry); err != nil {
				t.Fatal(err)
			}
			a.homeResult = &HomeResult{Session: entry, Saved: true, Text: entry.FinalTranscript}
			a.id, a.status.Phase = entry.ID, "done"
			previous := homeResult(t, a)
			tray := &fakeTray{}
			a.tray = tray
			if err := a.DeleteSessions([]string{entry.ID}); err != nil {
				t.Fatal(err)
			}
			if a.homeResult != nil {
				t.Fatal("deleted saved identity remained cached")
			}
			if available := tray.states[len(tray.states)-1].ResultAvailable; available != older {
				t.Fatal("tray availability disagrees with remaining History", available)
			}
			result, err := a.GetHomeResult()
			if err != nil || (!older && result != nil) || (older && (result == nil || result.Session.ID != "older")) {
				t.Fatal("Home did not resolve remaining History", result, err)
			}
			for _, action := range []string{"copy", "edit"} {
				if err := a.HomeResultAction(previous.Session.ID, previous.Revision, action, "stale"); err == nil {
					t.Fatal("deleted revision accepted", action)
				}
			}
		})
	}
}

func TestHistoryDeletionPreservesTemporaryAndDismissedHomeResults(t *testing.T) {
	for _, dismissed := range []bool{false, true} {
		t.Run(map[bool]string{false: "temporary", true: "dismissed"}[dismissed], func(t *testing.T) {
			a := testApp(t)
			entry := storage.NewSession("saved", 1000, "Saved peer", "tiny", "en", "")
			if err := a.store.Add(entry); err != nil {
				t.Fatal(err)
			}
			if dismissed {
				a.homeResultHidden = true
			} else {
				temporary := storage.NewSession("temporary", 1000, "Temporary result", "tiny", "en", "")
				a.homeResult = &HomeResult{Session: temporary, Text: temporary.FinalTranscript}
			}
			a.tray = &fakeTray{}
			if err := a.DeleteSessions([]string{entry.ID}); err != nil {
				t.Fatal(err)
			}
			result, err := a.GetHomeResult()
			if err != nil || (dismissed && result != nil) || (!dismissed && (result == nil || result.Session.ID != "temporary")) {
				t.Fatal("unrelated deletion changed the Home decision", result, err)
			}
		})
	}
}

func TestHistoryChangeInvalidatesEstablishedLegacySnapshot(t *testing.T) {
	a := testApp(t)
	seedRecentHistory(t, a)
	before, err := a.GetSnapshot()
	if err != nil || len(before.History) != 8 {
		t.Fatal("initial snapshot", len(before.History), err)
	}
	deletedID := before.History[0].ID
	if err := a.DeleteSessions([]string{deletedID}); err != nil {
		t.Fatal(err)
	}
	type reply struct {
		snapshot Snapshot
		err      error
	}
	replies := make(chan reply, 1)
	func() {
		if _, _, err := a.beginHomeResult(); err != nil {
			t.Fatal(err)
		}
		defer a.endHomeResult()
		go func() { snapshot, err := a.GetSnapshot(); replies <- reply{snapshot, err} }()
		awaitHomeFlag(t, a, func() bool { return a.homeHistoryWait != nil })
		if _, err := a.GetRuntimeSnapshot(); err != nil {
			t.Fatal("waiting legacy reader blocked transient state", err)
		}
	}()
	select {
	case got := <-replies:
		if got.err != nil || len(got.snapshot.History) != 7 {
			t.Fatal("legacy snapshot did not refresh", len(got.snapshot.History), got.err)
		}
		for _, entry := range got.snapshot.History {
			if entry.ID == deletedID {
				t.Fatal("deleted recording survived in the legacy cache")
			}
		}
	case <-time.After(2 * time.Second):
		t.Fatal("legacy snapshot did not resume after release")
	}
}
