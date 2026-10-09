package main

import (
	"errors"
	"testing"
)

func TestRetryShortcutRecoversAfterPermissionGrantWithoutChangingSettings(t *testing.T) {
	a := testApp(t)
	before := a.settings
	if err := a.store.SaveSettings(before); err != nil {
		t.Fatal(err)
	}
	granted, calls, events := false, 0, 0
	a.notify = func(topic string, _ ...interface{}) {
		if topic == "dictation:status" {
			events++
		}
	}
	a.registerKey = func(value string, _, _ func()) (shortcutRegistration, error) {
		calls++
		if value != before.Shortcut {
			t.Fatal("retry changed the saved shortcut")
		}
		if !granted {
			return nil, errors.New("Accessibility access required")
		}
		return &fakeShortcutRegistration{}, nil
	}
	if err := a.RetryShortcut(); err != nil || a.shortcut != nil || a.status.ShortcutError == "" {
		t.Fatal("pending permission was treated as a successful registration", err)
	}
	granted = true
	if err := a.RetryShortcut(); err != nil || a.shortcut == nil || a.status.ShortcutError != "" {
		t.Fatal("permission grant did not recover the shortcut", err)
	}
	if err := a.RetryShortcut(); err != nil || calls != 2 || events != 2 {
		t.Fatal("retry duplicated a working registration or failed to notify the UI", err, calls, events)
	}
	saved, err := a.store.Settings()
	if err != nil || saved != before || a.settings != before || a.status.Phase != "idle" || a.id != "" {
		t.Fatal("retry changed settings or started dictation", err)
	}
}

func TestRetryShortcutRejectsBusyCaptureAndShutdown(t *testing.T) {
	a := testApp(t)
	a.registerKey = func(string, func(), func()) (shortcutRegistration, error) {
		t.Fatal("registered during active work or shutdown")
		return nil, nil
	}
	for _, phase := range []string{"recording", "transcribing", "downloading", "mic-test", "diagnostic-recording", "diagnostic-transcribing", "backup", "text-processing"} {
		a.status.Phase = phase
		if err := a.RetryShortcut(); err == nil {
			t.Errorf("retry allowed during %s", phase)
		}
	}
	a.status.Phase = "idle"
	a.shortcutCaptureID = "active-capture"
	if err := a.RetryShortcut(); err == nil {
		t.Fatal("retry interrupted shortcut capture")
	}
	a.shortcutCaptureID = ""
	a.closing = true
	if err := a.RetryShortcut(); err == nil {
		t.Fatal("retry allowed after shutdown")
	}
}
