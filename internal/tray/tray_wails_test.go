//go:build windows || darwin

package tray

import (
	"sync"
	"testing"
	"time"
)

func TestWailsTrayCoalescesUpdatesAndRendersLatestState(t *testing.T) {
	queued := make(chan func(), 10)
	controller := newWailsTray(Actions{}, func(fn func()) { queued <- fn })
	t.Cleanup(controller.menu.Destroy)
	renders := 0
	controller.refresh = func(State) { renders++ }
	var writers sync.WaitGroup
	for range 20 {
		writers.Add(1)
		go func() {
			defer writers.Done()
			controller.Update(State{Phase: "recording", SaveHistory: true})
		}()
	}
	writers.Wait()
	controller.Update(State{Phase: "transcribing", Ready: true, SaveHistory: true})
	if len(queued) != 1 {
		t.Fatal("updates did not return promptly and coalesce into one UI operation")
	}
	(<-queued)()
	if controller.status.Label() != "Transcribing…" || controller.record.Enabled() || !controller.cancel.Enabled() || !controller.history.Checked() {
		t.Fatal("menu did not render the latest state")
	}
	controller.Update(State{Phase: "transcribing", Ready: true, SaveHistory: true})
	if len(queued) != 0 || renders != 1 {
		t.Fatal("unchanged recording updates refreshed the native menu")
	}
	controller.Update(State{Phase: "backup", SaveHistory: true})
	(<-queued)()
	if controller.history.Enabled() {
		t.Fatal("backup allowed the history preference to change")
	}
}

func TestWailsTrayCloseDiscardsPendingWork(t *testing.T) {
	var pending []func()
	controller := newWailsTray(Actions{Quit: func() { t.Error("closed tray dispatched Quit") }}, func(fn func()) { pending = append(pending, fn) })
	t.Cleanup(controller.menu.Destroy)
	controller.refresh = func(State) { t.Error("closed tray refreshed native resources") }
	destroyed := 0
	controller.destroy = func() { destroyed++ }
	controller.Update(State{Phase: "recording"})
	controller.Close()
	controller.Close()
	controller.Update(State{Phase: "idle"})
	controller.dispatch(quitAction)
	if destroyed != 1 || len(pending) != 1 {
		t.Fatal("close recreated resources or did not destroy them exactly once")
	}
	pending[0]()
}

func TestWailsTrayRevalidatesActionsAfterMenuOpens(t *testing.T) {
	called := make(chan struct{}, 1)
	controller := newWailsTray(Actions{Record: func() { called <- struct{}{} }}, func(func()) {})
	t.Cleanup(controller.menu.Destroy)
	controller.Update(State{Phase: "idle", Ready: true})
	controller.Update(State{Phase: "transcribing", Ready: true})
	controller.dispatch(recordAction)
	select {
	case <-called:
		t.Fatal("stale Start recording command ran during transcription")
	case <-time.After(30 * time.Millisecond):
	}
	controller.Update(State{Phase: "recording"})
	controller.dispatch(recordAction)
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("Stop recording command did not run")
	}
}
