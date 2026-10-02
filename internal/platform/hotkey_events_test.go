//go:build windows || cgo

package platform

import (
	"reflect"
	"testing"
	"time"

	"golang.design/x/hotkey"
)

func TestShortcutQueuedTapStopsAfterReleaseArrivesFirst(t *testing.T) {
	presses, releases := make(chan hotkey.Event), make(chan hotkey.Event)
	stop, done := make(chan struct{}), make(chan struct{})
	calls := make(chan string, 4)
	go func() {
		defer close(done)
		dispatchShortcutEvents(presses, releases, stop, func() { calls <- "down" }, func() { calls <- "up" })
	}()
	t.Cleanup(func() { close(stop); <-done })
	// Native order is press then release; the independently queued release
	// reaches the consumer first, as it can after a delayed callback.
	releases <- hotkey.Event{Sequence: 2}
	presses <- hotkey.Event{Sequence: 1}
	for _, want := range []string{"down", "up"} {
		select {
		case got := <-calls:
			if got != want {
				t.Fatalf("got %s, want %s", got, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("missing %s callback; a completed tap must not leave recording active", want)
		}
	}
}

func TestShortcutQueuedRepeatsAndTapsPreserveEveryEdge(t *testing.T) {
	presses, releases := make(chan hotkey.Event, 8), make(chan hotkey.Event, 8)
	// Two taps, with native auto-repeat on the first. Deliver whole queues
	// together, so callback order must come from source sequence numbers.
	for _, seq := range []uint64{1, 2, 3, 5} {
		presses <- hotkey.Event{Sequence: seq}
	}
	for _, seq := range []uint64{4, 6} {
		releases <- hotkey.Event{Sequence: seq}
	}
	stop, done := make(chan struct{}), make(chan struct{})
	calls := make(chan string, 8)
	go func() {
		defer close(done)
		dispatchShortcutEvents(presses, releases, stop, func() { calls <- "down" }, func() { calls <- "up" })
	}()
	t.Cleanup(func() { close(stop); <-done })
	got := []string{}
	for len(got) < 4 {
		select {
		case edge := <-calls:
			got = append(got, edge)
		case <-time.After(time.Second):
			t.Fatalf("lost queued tap: %v", got)
		}
	}
	if !reflect.DeepEqual(got, []string{"down", "up", "down", "up"}) {
		t.Fatalf("wrong callbacks: %v", got)
	}
}

func TestShortcutTapsQueuedDuringBlockedCallback(t *testing.T) {
	presses, releases := make(chan hotkey.Event, 8), make(chan hotkey.Event, 8)
	stop, done := make(chan struct{}), make(chan struct{})
	entered, resume := make(chan struct{}), make(chan struct{})
	calls := make(chan string, 8)
	first := true
	go func() {
		defer close(done)
		dispatchShortcutEvents(presses, releases, stop, func() {
			if first {
				first = false
				close(entered)
				<-resume
			}
			calls <- "down"
		}, func() { calls <- "up" })
	}()
	t.Cleanup(func() { close(stop); <-done })
	presses <- hotkey.Event{Sequence: 1}
	<-entered
	// Another complete tap arrives while recording setup holds the callback.
	releases <- hotkey.Event{Sequence: 2}
	releases <- hotkey.Event{Sequence: 4}
	presses <- hotkey.Event{Sequence: 3}
	close(resume)
	for _, want := range []string{"down", "up", "down", "up"} {
		select {
		case got := <-calls:
			if got != want {
				t.Fatalf("got %s, want %s", got, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("missing queued %s", want)
		}
	}
}
