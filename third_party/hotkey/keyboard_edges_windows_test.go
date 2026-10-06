package hotkey

import (
	"os"
	"testing"
	"time"
)

func TestNativeEdgesSurviveDelayedDelivery(t *testing.T) {
	state := &keyboardEdges{key: uint32(KeySpace), required: uint8(ModCtrl | ModAlt)}
	state.input(0xa2, true)
	state.input(0xa4, true)
	// Real source releases must survive even if consumer delivery waits for both taps.
	state.input(uint32(KeySpace), true)
	state.input(uint32(KeySpace), true)
	state.input(uint32(KeySpace), false)
	state.input(uint32(KeySpace), true)
	state.input(0xa2, false) // Releasing modifiers first must not lose the key release.
	state.input(uint32(KeySpace), false)
	if len(state.pending) != 4 {
		t.Fatal("native edge lost", state.pending)
	}
	for i, edge := range state.pending {
		if edge.down != (i%2 == 0) {
			t.Fatal("native order changed", state.pending)
		}
	}
	state.input(uint32(KeySpace), true)
	if len(state.pending) != 4 {
		t.Fatal("wrong modifiers accepted")
	}
}

func TestWindowsHookRegistrationAndQueuedSourceDelivery(t *testing.T) {
	if os.Getenv("YAP_HOTKEY_SMOKE") != "1" {
		t.Skip("set YAP_HOTKEY_SMOKE=1 for native hook registration")
	}
	h := New([]Modifier{ModCtrl, ModAlt, ModShift}, KeyF11)
	if err := h.Register(); err != nil {
		t.Fatal(err)
	}
	defer h.Unregister()
	done := make(chan struct{})
	h.funcs <- func() {
		if h.hook == 0 {
			t.Error("native keyboard hook missing")
		}
		h.edges.pressed = [256]bool{}
		h.edges.input(0xa2, true)
		h.edges.input(0xa4, true)
		h.edges.input(0xa0, true)
		for i := 0; i < 2; i++ {
			h.edges.input(uint32(KeyF11), true)
			h.edges.input(uint32(KeyF11), false)
		}
		close(done)
	}
	<-done
	for _, pair := range []struct {
		stream <-chan Event
		seq    uint64
	}{{h.Keyup(), 2}, {h.Keyup(), 4}, {h.Keydown(), 1}, {h.Keydown(), 3}} {
		select {
		case got := <-pair.stream:
			if got.Sequence != pair.seq {
				t.Fatal(got, pair.seq)
			}
		case <-time.After(time.Second):
			t.Fatal("native source lost queued edge")
		}
	}
}
