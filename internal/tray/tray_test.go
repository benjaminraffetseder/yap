package tray

import (
	"testing"
	"time"
)

func TestMenuFollowsRecordingState(t *testing.T) {
	for _, test := range []struct {
		name                         string
		state                        State
		record                       string
		recordEnabled, cancelEnabled bool
	}{
		{"setup", State{Phase: "idle"}, "Start recording", false, false},
		{"ready", State{Phase: "idle", Ready: true}, "Start recording", true, false},
		{"recording", State{Phase: "recording"}, "Stop recording", true, true},
		{"transcribing", State{Phase: "transcribing", Ready: true}, "Start recording", false, true},
		{"processing", State{Phase: "text-processing", Ready: true}, "Start recording", false, true},
		{"downloading", State{Phase: "downloading", Ready: true}, "Start recording", false, true},
		{"mic-test", State{Phase: "mic-test", Ready: true}, "Start recording", false, true},
		{"shortcut-capture", State{Phase: "shortcut-capture", Ready: true}, "Start recording", false, false},
		{"diagnostic-recording", State{Phase: "diagnostic-recording", Ready: true}, "Start recording", false, true},
		{"diagnostic-transcribing", State{Phase: "diagnostic-transcribing", Ready: true}, "Start recording", false, true},
		{"error", State{Phase: "error", Ready: true}, "Start recording", true, false},
		{"closing", State{Phase: "closing", Ready: true}, "Start recording", false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			v := presentation(test.state)
			if v.record != test.record || v.recordEnabled != test.recordEnabled || v.cancelEnabled != test.cancelEnabled {
				t.Fatalf("wrong menu state: %+v", v)
			}
		})
	}
}

func TestDisabledActionsCannotDispatch(t *testing.T) {
	called := make(chan struct{}, 1)
	a := Actions{Record: func() { called <- struct{}{} }, Cancel: func() { called <- struct{}{} }}
	a.dispatch(recordAction, State{Phase: "transcribing", Ready: true})
	a.dispatch(cancelAction, State{Phase: "idle", Ready: true})
	select {
	case <-called:
		t.Fatal("disabled menu action ran")
	case <-time.After(30 * time.Millisecond):
	}
	a.dispatch(recordAction, State{Phase: "recording"})
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("stop action did not run")
	}
}
