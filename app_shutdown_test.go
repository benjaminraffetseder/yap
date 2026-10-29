package main

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestShouldQuitLeavesUIAvailableForWorkers(t *testing.T) {
	a := NewApp()
	a.ctx = context.Background()
	ui := make(chan func(), 1)
	locked, delivered, quit := make(chan struct{}), make(chan struct{}), make(chan struct{}, 1)
	a.copyText = func(string) error {
		ui <- func() { close(delivered) }
		<-delivered
		return nil
	}
	var quits atomic.Int32
	a.quitApplication = func() { quits.Add(1); quit <- struct{}{} }
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.mu.Lock()
		defer a.mu.Unlock()
		close(locked)
		_ = a.copyText("transcript")
	}()
	<-locked
	// A worker owns App.mu and needs a UI callback. The UI's quit decision
	// must return before either that mutex or the worker can be drained.
	returned := make(chan bool, 1)
	go func() { returned <- a.shouldQuit() }()
	select {
	case allowed := <-returned:
		if allowed {
			t.Error("quit allowed before workers finished")
		}
	case <-time.After(time.Second):
		t.Error("quit decision blocked the UI")
	}
	for range 3 {
		if a.shouldQuit() {
			t.Error("repeated quit bypassed workers")
		}
	}
	select {
	case callback := <-ui:
		callback()
	case <-time.After(time.Second):
		t.Fatal("clipboard callback was not queued")
	}
	select {
	case <-quit:
	case <-time.After(time.Second):
		t.Fatal("quit was not retried after worker cleanup")
	}
	if !a.shouldQuit() || !a.closing || quits.Load() != 1 {
		t.Fatal("shutdown was not completed exactly once")
	}
	a.shutdown(a.ctx)
}
