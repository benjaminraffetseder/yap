package hotkey

import "testing"

func TestSequenceSurvivesIndependentQueueDelivery(t *testing.T) {
	var hk Hotkey
	hk.keydownIn, hk.keydownOut = newEventChan()
	hk.keyupIn, hk.keyupOut = newEventChan()
	defer close(hk.keydownIn)
	defer close(hk.keyupIn)
	// Native order: a held press/repeat/release, then a complete second tap.
	hk.keydownIn <- hk.nextEvent()
	hk.keydownIn <- hk.nextEvent()
	hk.keyupIn <- hk.nextEvent()
	hk.keydownIn <- hk.nextEvent()
	hk.keyupIn <- hk.nextEvent()
	// Consumers may see all releases before any presses. Source order must
	// survive the real asynchronous dependency queues so Yap can restore it.
	for _, want := range []uint64{3, 5} {
		if got := (<-hk.keyupOut).Sequence; got != want {
			t.Fatalf("release sequence=%d, want %d", got, want)
		}
	}
	for _, want := range []uint64{1, 2, 4} {
		if got := (<-hk.keydownOut).Sequence; got != want {
			t.Fatalf("press sequence=%d, want %d", got, want)
		}
	}
}
