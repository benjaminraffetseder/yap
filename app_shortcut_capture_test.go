package main

import (
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeShortcutRegistration struct{ closed int }

func (f *fakeShortcutRegistration) Close() { f.closed++ }

func TestShortcutCaptureRestoresRegistrationWithoutRecordingOrSaving(t *testing.T) {
	a := testApp(t)
	old := &fakeShortcutRegistration{}
	a.shortcut = old
	registered := 0
	a.registerKey = func(value string, _, _ func()) (shortcutRegistration, error) {
		if value != a.settings.Shortcut {
			t.Error("capture registered an unsaved shortcut")
		}
		registered++
		return &fakeShortcutRegistration{}, nil
	}
	before := a.settings
	token, err := a.BeginShortcutCapture()
	if err != nil || token == "" || old.closed != 1 || a.shortcut != nil {
		t.Fatal("capture did not release saved shortcut")
	}
	a.hotkeyDown()
	a.hotkeyUp()
	a.trayRecord()
	if a.status.Phase != "idle" || a.id != "" || a.shortcutTested {
		t.Fatal("capture started audio or passed setup test")
	}
	if _, err := a.BeginShortcutCapture(); err == nil {
		t.Fatal("duplicate capture allowed")
	}
	if err := a.StartRecording(); err == nil {
		t.Fatal("recording allowed during capture")
	}
	if err := a.SaveSettings(a.settings); err == nil {
		t.Fatal("settings changed during capture")
	}
	if err := a.EndShortcutCapture("stale"); err != nil || a.shortcutCaptureID != token {
		t.Fatal("stale callback ended active capture")
	}
	if err := a.EndShortcutCapture(token); err != nil {
		t.Fatal(err)
	}
	if err := a.EndShortcutCapture(token); err != nil {
		t.Fatal(err)
	}
	if registered != 1 || a.shortcut == nil || a.shortcutCaptureID != "" || a.shortcutCaptureTimer != nil || a.settings != before {
		t.Fatal("capture failed to restore saved state exactly once")
	}
}

func TestShortcutCaptureLeaseAndShutdownRestoreSafely(t *testing.T) {
	a := testApp(t)
	registered := 0
	a.registerKey = func(string, func(), func()) (shortcutRegistration, error) {
		registered++
		return &fakeShortcutRegistration{}, nil
	}
	done := make(chan struct{}, 1)
	a.notify = func(topic string, _ ...interface{}) {
		if topic == "shortcut:capture-ended" {
			done <- struct{}{}
		}
	}
	if _, err := a.BeginShortcutCapture(); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	a.shortcutCaptureTimer.Reset(0)
	a.mu.Unlock()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("lost webview lease did not expire")
	}
	a.mu.Lock()
	if registered != 1 || a.shortcutCaptureID != "" {
		t.Error("lease did not restore registration")
	}
	a.mu.Unlock()
	token, err := a.BeginShortcutCapture()
	if err != nil {
		t.Fatal(err)
	}
	a.shutdown(a.ctx)
	if err := a.EndShortcutCapture(token); err != nil || registered != 1 || a.shortcutCaptureTimer != nil {
		t.Fatal("late callback registered shortcut after shutdown")
	}
	if _, err := a.BeginShortcutCapture(); err == nil {
		t.Fatal("capture allowed during shutdown")
	}
}

func TestShortcutCaptureRejectsActiveWorkAndReportsRestorationFailure(t *testing.T) {
	a := testApp(t)
	a.registerKey = func(string, func(), func()) (shortcutRegistration, error) { return nil, errors.New("already in use") }
	for _, phase := range []string{"recording", "transcribing", "downloading", "mic-test", "diagnostic-recording", "diagnostic-transcribing"} {
		a.status.Phase = phase
		if _, err := a.BeginShortcutCapture(); err == nil {
			t.Errorf("capture during %s", phase)
		}
	}
	a.status.Phase = "idle"
	token, err := a.BeginShortcutCapture()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.EndShortcutCapture(token); err == nil || !strings.Contains(err.Error(), "choose another") || a.status.ShortcutError != "already in use" || a.shortcutCaptureID != "" {
		t.Fatal("restoration failure missing or capture stayed blocked")
	}
}

func TestShortcutSaveConflictPreservesPreviousSavedRegistration(t *testing.T) {
	a := testApp(t)
	if err := a.store.SaveSettings(a.settings); err != nil {
		t.Fatal(err)
	}
	old := &fakeShortcutRegistration{}
	a.shortcut = old
	restored := &fakeShortcutRegistration{}
	a.registerKey = func(value string, _, _ func()) (shortcutRegistration, error) {
		if value == "Ctrl+Alt+P" {
			return nil, errors.New("already in use")
		}
		return restored, nil
	}
	next := a.settings
	next.Shortcut = "Ctrl+Alt+P"
	err := a.SaveSettings(next)
	if err == nil || !strings.Contains(err.Error(), "your saved shortcut is unchanged") || a.shortcut != restored || old.closed != 1 || a.settings.Shortcut != "Ctrl+Alt+Space" {
		t.Fatal("conflict damaged old shortcut or lacked recovery guidance")
	}
	saved, err := a.store.Settings()
	if err != nil || saved.Shortcut != "Ctrl+Alt+Space" {
		t.Fatal("failed registration persisted candidate")
	}
	a.registerKey = func(string, func(), func()) (shortcutRegistration, error) { return &fakeShortcutRegistration{}, nil }
	if err := a.SaveSettings(next); err != nil {
		t.Fatal(err)
	}
	saved, err = a.store.Settings()
	if err != nil || saved.Shortcut != "Ctrl+Alt+P" {
		t.Fatal("available candidate did not persist")
	}
}

func TestRetiredShortcutCallbacksCannotRecordAfterCaptureEnds(t *testing.T) {
	a := testApp(t)
	var down, up func()
	a.registerKey = func(_ string, d, u func()) (shortcutRegistration, error) {
		down, up = d, u
		return &fakeShortcutRegistration{}, nil
	}
	a.registerShortcut()
	oldDown, oldUp := down, up
	token, err := a.BeginShortcutCapture()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.EndShortcutCapture(token); err != nil {
		t.Fatal(err)
	}
	oldDown()
	oldUp()
	if a.status.Phase != "idle" || a.id != "" {
		t.Fatal("queued retired callback started dictation after capture")
	}
	down()
	if a.status.Phase != "recording" {
		t.Fatal("restored registration cannot record")
	}
	oldUp()
	if a.status.Phase != "recording" {
		t.Fatal("retired keyup stopped new recording")
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
}
