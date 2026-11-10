package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
)

func TestShortcutPermissionWaitLeavesStateResponsiveAndCancellable(t *testing.T) {
	a := testApp(t)
	a.profileLibrary.ProfileShortcut = "Ctrl+Alt+P"
	a.registerKey = nil
	started := make(chan struct{})
	var calls atomic.Int32
	a.registerKeyContext = func(ctx context.Context, _ string, _, _ func()) (shortcutRegistration, error) {
		if calls.Add(1) != 1 {
			return nil, errors.New("unexpected follow-up permission request")
		}
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	done := make(chan error, 1)
	go func() { done <- a.RetryShortcut() }()
	<-started
	snapshot := make(chan error, 1)
	go func() { _, err := a.GetSnapshot(); snapshot <- err }()
	select {
	case err := <-snapshot:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("permission dialog blocked snapshots")
	}
	if err := a.StartRecording(); err == nil {
		t.Fatal("recording started during shortcut registration")
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("Cancel did not end permission wait")
	}
	if calls.Load() != 1 {
		t.Fatal("cancellation opened the profile permission dialog")
	}
	if a.shortcut != nil || a.status.ShortcutError == "" || a.shortcutRegistrationCancel != nil {
		t.Fatal("cancelled registration left stale state")
	}
}

func TestShutdownCancelsShortcutPermissionWait(t *testing.T) {
	a := testApp(t)
	a.registerKey = nil
	started := make(chan struct{})
	a.registerKeyContext = func(ctx context.Context, _ string, _, _ func()) (shortcutRegistration, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	retried := make(chan struct{})
	go func() { _ = a.RetryShortcut(); close(retried) }()
	<-started
	done := make(chan struct{})
	go func() { a.shutdown(a.ctx); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("shutdown waited on a permission dialog")
	}
	<-retried
}

type failingShortcutRegistration struct {
	done chan struct{}
	err  error
}

func (s *failingShortcutRegistration) Close()                {}
func (s *failingShortcutRegistration) Done() <-chan struct{} { return s.done }
func (s *failingShortcutRegistration) Err() error            { return s.err }

func TestLostShortcutSessionReportsErrorAndCanBeRetried(t *testing.T) {
	a := testApp(t)
	registration := &failingShortcutRegistration{done: make(chan struct{}), err: errors.New("desktop session closed")}
	calls := 0
	a.registerKey = func(string, func(), func()) (shortcutRegistration, error) {
		calls++
		if calls == 1 {
			return registration, nil
		}
		return &fakeShortcutRegistration{}, nil
	}
	if err := a.RetryShortcut(); err != nil {
		t.Fatal(err)
	}
	close(registration.done)
	deadline := time.Now().Add(time.Second)
	for {
		a.mu.Lock()
		failed := a.shortcut == nil && a.status.ShortcutError == registration.err.Error()
		a.mu.Unlock()
		if failed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("dead shortcut remained registered")
		}
		time.Sleep(time.Millisecond)
	}
	if err := a.RetryShortcut(); err != nil || calls != 2 || a.shortcut == nil || a.status.ShortcutError != "" {
		t.Fatalf("retry did not recover: %v", err)
	}
}

func TestClipboardPermissionWaitLeavesStateResponsiveAndCancellable(t *testing.T) {
	a := testApp(t)
	a.engine = importedSpeech{}
	a.status.Phase = "transcribing"
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancel = cancel
	defer cancel()
	started := make(chan struct{})
	a.copyTextContext = func(ctx context.Context, _ string) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	source := importedWAV(t)
	done := make(chan struct{})
	go func() {
		a.transcribe(ctx, "permission-test", source, "", 1000, a.settings, nil, textmodel.Defaults(), true, nil)
		close(done)
	}()
	<-started
	snapshot := make(chan error, 1)
	go func() { _, err := a.GetSnapshot(); snapshot <- err }()
	select {
	case err := <-snapshot:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("clipboard permission blocked snapshots")
	}
	if err := a.StartRecording(); err == nil {
		t.Fatal("new recording replaced the result during clipboard delivery")
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("clipboard permission wait ignored Cancel")
	}
	if a.homeResult == nil || a.homeResult.Text == "" || a.homeResult.Outcomes.Clipboard != "failed" {
		t.Fatal("cancelled delivery discarded the transcription")
	}
}

func TestCancelShortcutSavePreservesConfigurationWithoutAnotherPrompt(t *testing.T) {
	for _, profile := range []bool{false, true} {
		name := "recording"
		if profile {
			name = "profile"
		}
		t.Run(name, func(t *testing.T) {
			a := testApp(t)
			if err := a.store.SaveSettings(a.settings); err != nil {
				t.Fatal(err)
			}
			old := a.settings.Shortcut
			save := func() error {
				settings := a.settings
				settings.Shortcut = "Ctrl+Alt+Q"
				return a.SaveSettings(settings)
			}
			if profile {
				automationProfiles(t, a)
				if err := a.SaveProfileAutomation(nil, "Ctrl+Alt+P"); err != nil {
					t.Fatal(err)
				}
				old = a.profileLibrary.ProfileShortcut
				save = func() error { return a.SaveProfileAutomation(nil, "Ctrl+Alt+Q") }
			}
			a.registerKey = nil
			started := make(chan struct{})
			var calls atomic.Int32
			a.registerKeyContext = func(ctx context.Context, _ string, _, _ func()) (shortcutRegistration, error) {
				if calls.Add(1) != 1 {
					return nil, errors.New("unexpected rollback permission request")
				}
				close(started)
				<-ctx.Done()
				return nil, ctx.Err()
			}
			done := make(chan error, 1)
			go func() { done <- save() }()
			select {
			case <-started:
			case err := <-done:
				t.Fatalf("save did not request registration: %v", err)
			case <-time.After(time.Second):
				t.Fatal("save did not start")
			}
			if err := a.Cancel(); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("cancelled shortcut was saved")
				}
			case <-time.After(time.Second):
				t.Fatal("save did not cancel")
			}
			current := a.settings.Shortcut
			settings, err := a.store.Settings()
			saved := settings.Shortcut
			if profile {
				current = a.profileLibrary.ProfileShortcut
				library, readErr := a.store.DictationProfiles()
				saved, err = library.ProfileShortcut, readErr
			}
			if err != nil || calls.Load() != 1 || current != old || saved != old {
				t.Fatalf("cancel changed saved shortcut or prompted again: current=%q saved=%q calls=%d err=%v", current, saved, calls.Load(), err)
			}
		})
	}
}
