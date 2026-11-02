//go:build windows || (darwin && cgo)

package indicator

import (
	"math"
	"testing"
	"time"
)

type fixture struct {
	controller       *wailsIndicator
	queue            []func()
	frames           []frame
	visible, focused bool
	placements       []bool
}

func newFixture(t *testing.T) *fixture {
	f := &fixture{}
	f.controller = newWailsIndicator(Actions{}, func(fn func()) { f.queue = append(f.queue, fn) })
	f.controller.focused = func() bool { return f.focused }
	f.controller.place = func(reposition bool) { f.placements = append(f.placements, reposition) }
	f.controller.show = func() { f.visible = true }
	f.controller.hide = func() { f.visible = false }
	f.controller.drag = func(pointerDrag) {}
	f.controller.send = func(frame frame) { f.frames = append(f.frames, frame) }
	t.Cleanup(f.controller.Close)
	return f
}
func (f *fixture) flush() {
	for len(f.queue) > 0 {
		queue := f.queue
		f.queue = nil
		for _, fn := range queue {
			fn()
		}
	}
}
func (f *fixture) tick() { f.controller.schedule(); f.flush() }

func TestWailsIndicatorReadinessFocusAndExpiry(t *testing.T) {
	f := newFixture(t)
	c := f.controller
	c.Update(State{Phase: "recording", StartedAt: time.Now().Add(-65 * time.Second).UnixMilli()})
	f.flush()
	if f.visible || len(f.frames) != 0 {
		t.Fatal("window shown before its frontend subscribed")
	}
	c.ready = true
	f.focused = true
	f.tick()
	if f.visible {
		t.Fatal("indicator shown over a focused Yap window")
	}
	f.focused = false
	f.tick()
	if !f.visible || f.frames[len(f.frames)-1].Label != "Recording  1:05" {
		t.Fatal("background recording lost its elapsed time")
	}
	f.focused = true
	f.tick()
	if f.visible {
		t.Fatal("focusing Yap did not hide the indicator")
	}
	c.Update(State{Phase: "done", Message: "Copied to clipboard"})
	f.flush()
	c.expires = time.Now().Add(-time.Second)
	f.focused = false
	f.tick()
	if f.visible || c.active {
		t.Fatal("focus change replayed an expired notification")
	}
	// Even an identical state is a fresh notification after another attempt.
	c.Update(State{Phase: "done", Message: "Copied to clipboard"})
	f.flush()
	if !f.visible {
		t.Fatal("repeated completion failed to refresh expiry")
	}
}

func TestWailsIndicatorActionsRevalidateRevisionAndPhase(t *testing.T) {
	f := newFixture(t)
	c := f.controller
	c.ready = true
	called := make(chan string, 4)
	c.actions = Actions{Stop: func(string) { called <- "stop" }, Cancel: func(string) { called <- "cancel" }, Show: func() { called <- "show" }}
	c.Update(State{Phase: "recording"})
	f.flush()
	old := c.revision
	c.Update(State{Phase: "transcribing"})
	f.flush()
	c.dispatch("primary", old)
	c.dispatch("primary", c.revision)
	select {
	case action := <-called:
		t.Fatalf("stale stop ran: %s", action)
	default:
	}
	c.dispatch("secondary", c.revision)
	select {
	case action := <-called:
		if action != "cancel" {
			t.Fatal(action)
		}
	case <-time.After(time.Second):
		t.Fatal("Cancel was not called")
	}
	c.Update(State{Phase: "error"})
	f.flush()
	c.dispatch("primary", c.revision)
	select {
	case action := <-called:
		if action != "show" {
			t.Fatal(action)
		}
	case <-time.After(time.Second):
		t.Fatal("Open Yap was not called")
	}
	c.dispatch("secondary", c.revision)
	f.flush()
	if f.visible {
		t.Fatal("Dismiss left the window visible")
	}
	f.focused = true
	f.tick()
	f.focused = false
	f.tick()
	if f.visible {
		t.Fatal("focus change replayed a dismissed notification")
	}
	c.Update(State{Phase: "error"})
	f.flush()
	if !f.visible {
		t.Fatal("a repeated error did not clear dismissal")
	}
}

func TestWailsIndicatorActionsKeepTheirSession(t *testing.T) {
	for _, action := range []string{"primary", "secondary"} {
		t.Run(action, func(t *testing.T) {
			f := newFixture(t)
			c := f.controller
			c.ready = true
			resume := make(chan struct{})
			called := make(chan string, 1)
			callback := func(id string) { <-resume; called <- id }
			c.actions = Actions{Stop: callback, Cancel: callback}
			c.Update(State{SessionID: "A", Phase: "recording"})
			f.flush()
			c.dispatch(action, c.revision)
			c.Update(State{SessionID: "B", Phase: "recording"})
			f.flush()
			close(resume)
			select {
			case id := <-called:
				if id != "A" {
					t.Fatalf("accepted action changed session to %q", id)
				}
			case <-time.After(time.Second):
				t.Fatal("action did not finish")
			}
		})
	}
}

func TestWailsIndicatorRefreshKeepsPlacement(t *testing.T) {
	f := newFixture(t)
	c := f.controller
	c.ready = true
	c.Update(State{SessionID: "A", Phase: "recording"})
	f.flush()
	if len(f.placements) != 1 || !f.placements[0] {
		t.Fatal("initial window was not positioned")
	}
	f.tick()
	c.SetLevel(.8)
	f.tick()
	c.Update(State{SessionID: "A", Phase: "transcribing"})
	f.flush()
	for _, reposition := range f.placements[1:] {
		if reposition {
			t.Fatal("status refresh repositioned a visible window")
		}
	}
	f.focused = true
	f.tick()
	f.focused = false
	f.tick()
	if !f.placements[len(f.placements)-1] {
		t.Fatal("showing the indicator did not request placement")
	}
}

func TestWailsIndicatorCoalescesAndStopsQueuedWork(t *testing.T) {
	f := newFixture(t)
	c := f.controller
	c.ready = true
	for range 100 {
		c.Update(State{Phase: "recording"})
		c.SetLevel(.8)
		c.SetTheme(false)
	}
	if len(f.queue) != 1 {
		t.Fatalf("queued %d renders", len(f.queue))
	}
	f.flush()
	if len(f.frames) != 1 || f.frames[0].Dark || f.frames[0].Level != .8 {
		t.Fatal("coalescing lost the latest state")
	}
	for _, level := range []float64{math.NaN(), math.Inf(1), -1} {
		c.SetLevel(level)
		f.tick()
		if c.last.Level != 0 {
			t.Fatal("invalid meter level escaped clamping")
		}
	}
	c.SetLevel(2)
	f.tick()
	if c.last.Level != 1 {
		t.Fatal("loud level escaped clamping")
	}
	before := len(f.frames)
	f.tick()
	if len(f.frames) != before {
		t.Fatal("unchanged frame was broadcast again")
	}
	c.SetTheme(true)
	c.Close()
	c.Close()
	f.flush()
	if len(f.frames) != before {
		t.Fatal("queued render ran after close")
	}
	c.Update(State{Phase: "error"})
	if len(f.queue) != 0 {
		t.Fatal("closed controller accepted updates")
	}
}

func TestWailsIndicatorExpiredAndIdleActions(t *testing.T) {
	f := newFixture(t)
	c := f.controller
	c.ready = true
	called := make(chan struct{}, 1)
	c.actions.Show = func() { called <- struct{}{} }
	c.Update(State{Phase: "error"})
	c.expires = time.Now().Add(-time.Second)
	c.dispatch("primary", c.revision)
	f.flush()
	select {
	case <-called:
		t.Fatal("expired action ran")
	default:
	}
	c.Update(State{Phase: "idle"})
	f.flush()
	if f.visible || c.active {
		t.Fatal("idle indicator kept polling the desktop")
	}
}

func TestWailsIndicatorRecoveryStaysAvailableUntilDismissed(t *testing.T) {
	f := newFixture(t)
	c := f.controller
	c.ready = true
	c.Update(State{Phase: "done", Message: "Automatic paste failed; copied to clipboard. Paste manually."})
	f.flush()
	if !f.visible || !c.expires.IsZero() {
		t.Fatal("recoverable result would expire before it is reviewed")
	}
	f.focused = true
	f.tick()
	f.focused = false
	f.tick()
	if !f.visible {
		t.Fatal("returning to another app lost the recovery action")
	}
	c.dispatch("secondary", c.revision)
	f.flush()
	if f.visible {
		t.Fatal("explicitly dismissed recovery stayed visible")
	}
}

func TestWailsIndicatorDragIgnoresLateMessages(t *testing.T) {
	f := newFixture(t)
	c := f.controller
	c.ready = true
	c.Update(State{Phase: "recording"})
	f.flush()
	var actions []string
	c.drag = func(d pointerDrag) { actions = append(actions, d.Action) }
	// End can arrive before start: the original anchor is present on each event.
	c.handleDrag(pointerDrag{ID: 2, Action: "end", X: .3, Y: .5})
	count := len(actions)
	c.handleDrag(pointerDrag{ID: 2, Action: "start", X: .3, Y: .5})
	c.handleDrag(pointerDrag{ID: 2, Action: "move", X: .3, Y: .5})
	c.handleDrag(pointerDrag{ID: 1, Action: "end", X: .3, Y: .5})
	if len(actions) != count || count != 4 {
		t.Fatalf("late drag messages changed geometry: %v", actions)
	}
	c.handleDrag(pointerDrag{ID: 3, Action: "start", X: .1, Y: .5})
	if len(actions) != count+2 {
		t.Fatal("the next drag was rejected")
	}
	c.Update(State{Phase: "idle"})
	f.flush()
	count = len(actions)
	c.handleDrag(pointerDrag{ID: 3, Action: "move", X: .1, Y: .5})
	if len(actions) != count {
		t.Fatal("hidden window kept following the pointer")
	}
}
