package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
	"unsafe"

	"yap/internal/storage"
)

func homeResult(t *testing.T, a *App) *HomeResult {
	t.Helper()
	r, err := a.GetHomeResult()
	if err != nil || r == nil {
		t.Fatal("missing Home result", err)
	}
	return r
}

func TestHomeTemporaryEditSaveAndStaleActions(t *testing.T) {
	a := testApp(t)
	a.SetSaveHistory(false)
	recordTemporary(t, a)
	r := homeResult(t, a)
	before := r.Session.RawTranscript
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "edit", "Synthetic correction."); err != nil {
		t.Fatal(err)
	}
	if a.latestResult == nil || a.latestResult.Text != "Synthetic correction." || a.latestResult.Session.RawTranscript != before {
		t.Fatal("temporary edit lost text or recognition")
	}
	history, _ := a.store.History()
	if len(history) != 0 {
		t.Fatal("temporary edit persisted")
	}
	for _, action := range []string{"edit", "copy", "save", "dismiss"} {
		if err := a.HomeResultAction(r.Session.ID, r.Revision, action, "stale"); err == nil {
			t.Fatal("stale action accepted", action)
		}
	}
	r = homeResult(t, a)
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "save", ""); err != nil {
		t.Fatal(err)
	}
	if a.latestResult != nil {
		t.Fatal("legacy temporary result survived save")
	}
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "save", ""); err == nil {
		t.Fatal("duplicate save accepted")
	}
	r = homeResult(t, a)
	if !r.Saved || r.Session.FinalTranscript != "Synthetic correction." || r.Session.RawTranscript != before {
		t.Fatal("explicit save lost correction/provenance")
	}
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "copy", ""); err == nil {
		t.Fatal("copy accepted during recording")
	}
	a.Cancel()
}

func TestHomeSavedEditsKeepOutputsAndRejectDeletedIdentities(t *testing.T) {
	a := testApp(t)
	enableText(t, a, true)
	a.textEngine = &fakeTextEngine{output: "Synthetic generated output."}
	recordTemporary(t, a)
	r := homeResult(t, a)
	if !r.Saved || r.OutputID == "" || len(r.Outputs) != 1 {
		t.Fatal("saved generated result unavailable")
	}
	outputID := r.OutputID
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "edit", "Synthetic edited result."); err != nil {
		t.Fatal(err)
	}
	updated := homeResult(t, a)
	if updated.OutputID != "" || updated.Session.RawTranscript != r.Session.RawTranscript || updated.Outputs[0].Text != r.Outputs[0].Text {
		t.Fatal("edit changed provenance")
	}
	if err := a.DeleteSessionOutput(r.Session.ID, outputID); err != nil {
		t.Fatal(err)
	}
	if err := a.HomeResultAction(updated.Session.ID, updated.Revision, "copy:"+outputID, ""); err == nil {
		t.Fatal("deleted output copied")
	}
	updated = homeResult(t, a)
	if err := a.DeleteSession(updated.Session.ID); err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"copy", "edit"} {
		if err := a.HomeResultAction(updated.Session.ID, updated.Revision, action, "stale"); err == nil {
			t.Fatal("deleted result accepted", action)
		}
	}
}

func TestHomeDismissHidesSavedAndTemporaryResultsWithoutChangingHistory(t *testing.T) {
	for _, saved := range []bool{false, true} {
		name := "temporary"
		if saved {
			name = "saved"
		}
		t.Run(name, func(t *testing.T) {
			a := testApp(t)
			enableText(t, a, true)
			if err := a.SetSaveHistory(saved); err != nil {
				t.Fatal(err)
			}
			a.textEngine = &fakeTextEngine{output: "Synthetic generated result to dismiss."}
			recordTemporary(t, a)
			r := homeResult(t, a)
			history, err := a.store.History()
			if err != nil {
				t.Fatal(err)
			}
			outputs, err := a.store.GeneratedOutputs(r.Session.ID)
			if err != nil {
				t.Fatal(err)
			}
			if err := a.HomeResultAction(r.Session.ID, r.Revision, "dismiss", ""); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if result, err := a.GetHomeResult(); err != nil || result != nil {
					t.Fatalf("dismissed result reappeared: result=%+v, err=%v", result, err)
				}
			}
			after, err := a.store.History()
			if err != nil || !reflect.DeepEqual(history, after) {
				t.Fatalf("dismiss changed saved History: %v", err)
			}
			afterOutputs, err := a.store.GeneratedOutputs(r.Session.ID)
			if err != nil || !reflect.DeepEqual(outputs, afterOutputs) {
				t.Fatalf("dismiss changed generated outputs: %v", err)
			}
			if a.latestResult != nil || a.settings.SaveHistory != saved {
				t.Fatal("dismiss retained temporary text or changed the history preference")
			}
			if err := a.HomeResultAction(r.Session.ID, r.Revision, "copy", ""); err == nil {
				t.Fatal("dismissed result accepted a stale action")
			}
		})
	}
}

// Test-only access avoids adding a production connection/diagnostic API. This
// borrows the actual sole SQLite connection rather than simulating a closed DB.
func homeTestDB(a *App) *sql.DB {
	return (*sql.DB)(unsafe.Pointer(reflect.ValueOf(a.store).Elem().FieldByName("db").Pointer()))
}

func TestHomeHistoryFailureRecoveryAndCopyRetry(t *testing.T) {
	a := testApp(t)
	db := homeTestDB(a)
	if _, err := db.Exec("PRAGMA query_only=ON"); err != nil {
		t.Fatal(err)
	}
	recordTemporary(t, a)
	if _, err := db.Exec("PRAGMA query_only=OFF"); err != nil {
		t.Fatal(err)
	}
	r := homeResult(t, a)
	if r.Saved || r.Outcomes.History != "failed" || a.latestResult == nil || !a.status.CompletionWarning {
		t.Fatal("History failure lost recoverable text")
	}
	metadata, _ := json.Marshal(r.Outcomes)
	if strings.Contains(string(metadata), r.Text) || strings.Contains(string(metadata), a.path) {
		t.Fatal("outcomes leaked content")
	}
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "save", ""); err != nil {
		t.Fatal(err)
	}
	r = homeResult(t, a)
	a.copyText = func(string) error { return errors.New("synthetic clipboard failure") }
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "copy", ""); err == nil {
		t.Fatal("failed copy reported success")
	}
	r = homeResult(t, a)
	if r.Outcomes.Clipboard != "failed" || !r.Saved {
		t.Fatal("failed copy lost result")
	}
	copies := 0
	a.copyText = func(string) error { copies++; return nil }
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "copy", ""); err != nil {
		t.Fatal(err)
	}
	if copies != 1 || homeResult(t, a).Outcomes.Clipboard != "complete" {
		t.Fatal("explicit copy retry failed")
	}
}

func awaitHomeFlag(t *testing.T, a *App, flag func() bool) {
	t.Helper()
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for {
		a.mu.Lock()
		ready := flag()
		a.mu.Unlock()
		if ready {
			return
		}
		select {
		case <-tick.C:
		case <-deadline.C:
			t.Fatal("state did not become ready")
		}
	}
}

func TestHomeHeldSQLiteLeaseKeepsControlPathsPrompt(t *testing.T) {
	a := testApp(t)
	entry := storage.NewSession("synthetic", 1000, "Synthetic text.", "tiny", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetSnapshot(); err != nil {
		t.Fatal(err)
	}
	r := homeResult(t, a)
	conn, err := homeTestDB(a).Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	finished := make(chan error, 1)
	go func() { finished <- a.HomeResultAction(r.Session.ID, r.Revision, "edit", "Synthetic blocked edit.") }()
	awaitHomeFlag(t, a, func() bool { return a.homeResultOperation })
	a.mu.Lock()
	a.status.HistoryError = "Existing cleanup warning"
	a.mu.Unlock()
	checks := []func(){
		func() {
			s, err := a.GetSnapshot()
			if err != nil || len(s.History) != 1 {
				t.Error("snapshot did not use cache")
			}
		},
		func() {
			if _, err := a.GetHistory("", 0); err == nil {
				t.Error("History read ignored lease")
			}
		},
		func() {
			if _, err := a.GetRevisions("transcript", entry.ID); err == nil {
				t.Error("revision read ignored lease")
			}
		},
		func() {
			if err := a.SetSaveHistory(false); err == nil {
				t.Error("preference write ignored lease")
			}
		},
		func() {
			if err := a.SaveSettings(a.settings); err == nil {
				t.Error("settings write ignored lease")
			}
		},
		func() {
			a.mu.Lock()
			a.pruneHistoryLocked()
			if a.status.HistoryError != "Existing cleanup warning" {
				t.Error("deferred cleanup cleared warning")
			}
			a.mu.Unlock()
		},
		func() { a.Cancel() },
	}
	for i, call := range checks {
		done := make(chan struct{})
		go func() { call(); close(done) }()
		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			conn.Close()
			t.Fatal("control path blocked", i)
		}
	}
	shutdown := make(chan struct{})
	go func() { a.shutdown(a.ctx); close(shutdown) }()
	awaitHomeFlag(t, a, func() bool { return a.closing })
	// shutdown must release App.mu while waiting for the held operation.
	control := make(chan struct{})
	go func() { a.Cancel(); close(control) }()
	select {
	case <-control:
	case <-time.After(500 * time.Millisecond):
		conn.Close()
		t.Fatal("shutdown held App.mu")
	}
	conn.Close()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("Home lease did not finish")
	}
	select {
	case <-shutdown:
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not finish")
	}
}

func TestHomeRejectedStartPreservesPriorResultAndBackupGuards(t *testing.T) {
	a := testApp(t)
	a.SetSaveHistory(false)
	recordTemporary(t, a)
	r := homeResult(t, a)
	a.recorder = &selectedCapture{failure: errors.New("synthetic capture failure")}
	if err := a.StartRecording(); err == nil {
		t.Fatal("failed capture accepted")
	}
	if homeResult(t, a).Revision != r.Revision {
		t.Fatal("failed start invalidated prior result")
	}
	a.mu.Lock()
	previous, _, err := a.beginBackupLocked("Synthetic backup")
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetHomeResult(); err == nil {
		t.Fatal("Home read allowed during backup")
	}
	if err := a.HomeResultAction(r.Session.ID, r.Revision, "copy", ""); err == nil {
		t.Fatal("Home copy allowed during backup")
	}
	a.mu.Lock()
	a.finishBackupLocked(previous)
	a.mu.Unlock()
	a.wg.Done()
}

func TestHomeConcurrentReadsAfterNavigation(t *testing.T) {
	for _, saved := range []bool{false, true} {
		name := "temporary"
		if saved {
			name = "saved"
		}
		t.Run(name, func(t *testing.T) {
			a := testApp(t)
			entry := storage.NewSession("navigation", 1000, "Synthetic navigation result.", "tiny", "en", "")
			if saved {
				if err := a.store.Add(entry); err != nil {
					t.Fatal(err)
				}
			} else {
				a.latestResult = &TemporaryResult{Session: entry, Text: entry.FinalTranscript}
			}
			conn, err := homeTestDB(a).Conn(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			type reply struct {
				result *HomeResult
				err    error
			}
			first := make(chan reply, 1)
			go func() {
				result, err := a.GetHomeResult()
				first <- reply{result, err}
			}()
			awaitHomeFlag(t, a, func() bool { return a.homeResultOperation })
			// Returning to Home (or Strict Mode remounting it) can issue a second
			// read while the first is still waiting on the actual SQLite connection.
			release := time.AfterFunc(100*time.Millisecond, func() { conn.Close() })
			second, secondErr := a.GetHomeResult()
			release.Stop()
			conn.Close()
			select {
			case previous := <-first:
				if previous.err != nil || previous.result == nil || previous.result.Text != entry.FinalTranscript {
					t.Fatalf("first read lost the result: %+v", previous)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("first read did not complete")
			}
			if secondErr != nil || second == nil || second.Text != entry.FinalTranscript || second.Saved != saved {
				t.Fatalf("returning to Home rejected the overlapping read: result=%+v, err=%v", second, secondErr)
			}
			if a.busy() {
				t.Fatal("result read left the app busy")
			}
		})
	}
}
