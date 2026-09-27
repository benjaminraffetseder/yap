package main

import (
	"os"
	"sync"
	"testing"
	"time"

	"yap/internal/tray"
)

type fakeTray struct {
	mu         sync.Mutex
	states     []tray.State
	closeCount int
}

func (f *fakeTray) Update(s tray.State) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.states = append(f.states, s)
}
func (f *fakeTray) Close() { f.mu.Lock(); defer f.mu.Unlock(); f.closeCount++ }

func TestCloseToTrayPreservesRecordingAndReopens(t *testing.T) {
	a := testApp(t)
	f := &fakeTray{}
	a.tray, a.closeToTray = f, true
	hidden, shown := 0, 0
	a.hideWindow = func() { hidden++ }
	a.showWindow = func() { shown++ }
	a.trayRecord()
	if a.status.Phase != "recording" {
		t.Fatal("tray did not start recording")
	}
	if a.target != "" {
		t.Fatal("menu recording selected an automatic paste target")
	}
	if !a.beforeClose(a.ctx) || a.closing || a.status.Phase != "recording" || hidden != 1 || f.closeCount != 0 {
		t.Fatal("window close shut down background recording")
	}
	if _, err := os.Stat(a.path); err != nil {
		t.Fatal("window close removed active audio")
	}
	a.show()
	if shown != 1 {
		t.Fatal("hidden main window did not reopen")
	}
	a.trayRecord()
	a.wg.Wait()
	if a.status.Phase != "done" || a.status.Message != "Copied to clipboard" {
		t.Fatalf("tray stop did not complete: %+v", a.status)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.states) != 3 || f.states[0].Phase != "recording" || f.states[1].Phase != "transcribing" || f.states[2].Phase != "done" {
		t.Fatalf("tray missed recording lifecycle: %+v", f.states)
	}
}

func TestTrayQuitCleansUpInsteadOfHiding(t *testing.T) {
	a := testApp(t)
	f := &fakeTray{}
	a.tray, a.closeToTray = f, true
	a.hideWindow = func() { t.Error("explicit quit hid the app") }
	quits := 0
	a.quitApplication = func() {
		quits++
		if a.beforeClose(a.ctx) {
			t.Error("explicit quit was prevented")
		}
	}
	a.trayRecord()
	path := a.path
	a.quit()
	a.quit()
	if !a.closing || quits != 1 || f.closeCount != 1 {
		t.Fatal("quit did not close tray exactly once")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("quit retained unfinished recording")
	}
	a.shutdown(a.ctx)
	if f.closeCount != 1 {
		t.Fatal("shutdown hook closed tray twice")
	}
}

func TestCloseWithoutTrayRemainsAnExit(t *testing.T) {
	a := testApp(t)
	a.closeToTray = true
	a.hideWindow = func() { t.Error("app hid without an available tray") }
	if a.beforeClose(a.ctx) || !a.closing {
		t.Fatal("window close trapped an app without a tray")
	}
}

func TestTrayQuitCancelsTranscriptionAndRemovesAudio(t *testing.T) {
	a := testApp(t)
	f := &fakeTray{}
	a.tray, a.closeToTray = f, true
	started := make(chan struct{})
	a.engine = fakeSpeech{wait: true, started: started}
	a.settings.SaveAudio = true
	a.copyText = func(string) error { t.Error("quit copied cancelled transcription"); return nil }
	a.quitApplication = func() { a.beforeClose(a.ctx) }
	a.trayRecord()
	path := a.path
	a.trayRecord()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("transcription did not start")
	}
	a.quit()
	if !a.closing || f.closeCount != 1 {
		t.Fatal("quit did not finish worker and tray cleanup")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("quit retained cancelled audio")
	}
}

func TestNativeAppQuitStillExits(t *testing.T) {
	// AppKit intercepts the close button natively, so its Wails close hook only
	// receives actual application termination (Cmd+Q, Dock Quit, menu Quit).
	a := testApp(t)
	f := &fakeTray{}
	a.tray = f
	a.closeToTray = false
	if a.beforeClose(a.ctx) || !a.closing || f.closeCount != 1 {
		t.Fatal("native app quit did not clean up")
	}
}

func TestLateStartupCannotRecreateBackgroundControls(t *testing.T) {
	a := testApp(t)
	a.shutdown(a.ctx)
	// Wails schedules startup asynchronously. Closing before it runs must not
	// create native controls after the shutdown hook has already completed.
	a.startup(a.ctx)
	if !a.closing || a.tray != nil || a.indicator != nil {
		t.Fatal("late startup recreated native controls")
	}
}
