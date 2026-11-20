package operations

import "testing"

func TestPermissionWaitKeepsHistoryReadableWhileReservingOtherWork(t *testing.T) {
	state := State{DatabaseReady: true, ShortcutRegistration: true}
	if !state.Busy() || state.HistoryAvailable() != nil {
		t.Fatal("permission wait must reserve work without blocking saved reads")
	}
	state.Phase = "backup"
	if state.HistoryAvailable() == nil {
		t.Fatal("history was available while backup owns the connection")
	}
	state.Closing, state.DatabaseReady = true, false
	if err := state.HistoryAvailable(); err == nil || err.Error() != "app is shutting down" {
		t.Fatal("shutdown lost precedence over other availability errors", err)
	}
}
