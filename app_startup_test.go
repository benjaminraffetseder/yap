package main

import (
	"errors"
	"slices"
	"testing"
)

type fakeLoginStart struct {
	enabled bool
	readErr error
	failAt  int
	calls   []bool
}

func (f *fakeLoginStart) Enabled() (bool, error) { return f.enabled, f.readErr }
func (f *fakeLoginStart) SetEnabled(enabled bool) error {
	f.calls = append(f.calls, enabled)
	if f.failAt == len(f.calls) {
		return errors.New("registration failed")
	}
	f.enabled = enabled
	return nil
}

func TestInitialWindowDecision(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*App)
		shown  int
	}{
		{"background", func(*App) {}, 0},
		{"default", func(a *App) { a.settings.StartInTray = false }, 1},
		{"tray failed", func(a *App) { a.tray = nil }, 1},
		{"setup needed", func(a *App) { a.settings.ModelPath = "" }, 1},
		{"unfinished setup", func(a *App) { a.settings.SetupComplete = false }, 1},
		{"shortcut failed", func(a *App) { a.status.ShortcutError = "occupied" }, 1},
		{"login failed", func(a *App) { a.status.StartupError = "registration unavailable" }, 1},
		{"startup failed", func(a *App) { a.status.Phase = "error" }, 1},
		{"development", func(a *App) { a.development = true }, 1},
		{"second launch", func(a *App) { a.windowRequested = true }, 1},
		{"shutting down", func(a *App) { a.closing = true }, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			a := testApp(t)
			a.tray = &fakeTray{}
			a.settings.StartInTray = true
			a.startupComplete = true
			shown := 0
			a.showWindow = func() { shown++ }
			test.change(a)
			a.onDomReady(a.ctx)
			a.onDomReady(a.ctx) // Reloads must not repeat the initial decision.
			if shown != test.shown {
				t.Fatalf("window shown %d times, want %d", shown, test.shown)
			}
		})
	}
}

func TestInitialWindowWaitsForStartupAndHonorsReopen(t *testing.T) {
	a := testApp(t)
	a.tray = &fakeTray{}
	a.settings.StartInTray = true
	shown := 0
	a.showWindow = func() { shown++ }
	a.onDomReady(a.ctx)
	if shown != 0 || a.initialWindowApplied {
		t.Fatal("decided before native startup finished")
	}
	a.show() // A second launch during startup must override background mode.
	a.mu.Lock()
	a.startupComplete = true
	show := a.initialWindowLocked()
	a.mu.Unlock()
	if show == nil {
		t.Fatal("initial startup ignored a reopen request")
	}
	show()
	if shown != 2 {
		t.Fatal("reopen request did not reveal the ready window")
	}
}

func TestSaveStartupPreferences(t *testing.T) {
	a := testApp(t)
	a.tray = &fakeTray{}
	f := &fakeLoginStart{}
	a.loginStart = f
	next := a.settings
	next.LaunchAtLogin, next.StartInTray = true, true
	if err := a.SaveSettings(next); err != nil {
		t.Fatal(err)
	}
	saved, err := a.store.Settings()
	if err != nil || saved != next || !f.enabled {
		t.Fatalf("startup options not saved: %+v, %v", saved, err)
	}
	next.LaunchAtLogin, next.StartInTray = false, false
	if err := a.SaveSettings(next); err != nil {
		t.Fatal(err)
	}
	if f.enabled || !slices.Equal(f.calls, []bool{true, false}) {
		t.Fatalf("login registration not removed: %+v", f.calls)
	}
}

func TestStartupRegistrationFailurePreservesSettings(t *testing.T) {
	a := testApp(t)
	f := &fakeLoginStart{failAt: 1}
	a.loginStart = f
	old := a.settings
	if err := a.store.SaveSettings(old); err != nil {
		t.Fatal(err)
	}
	next := old
	next.LaunchAtLogin, next.Language = true, "de"
	if err := a.SaveSettings(next); err == nil {
		t.Fatal("ignored native registration failure")
	}
	saved, err := a.store.Settings()
	if err != nil || saved != old || a.settings != old || f.enabled {
		t.Fatalf("failed registration changed settings: %+v, %v", saved, err)
	}
}

func TestSaveFailureRestoresLoginRegistration(t *testing.T) {
	for _, original := range []bool{false, true} {
		t.Run(map[bool]string{false: "enable", true: "disable"}[original], func(t *testing.T) {
			a := testApp(t)
			f := &fakeLoginStart{enabled: original}
			a.loginStart = f
			a.settings.LaunchAtLogin = original
			old := a.settings
			a.store.Close() // Native registration succeeds, then SQLite rejects save.
			next := old
			next.LaunchAtLogin = !original
			if err := a.SaveSettings(next); err == nil {
				t.Fatal("ignored database failure")
			}
			if a.settings != old || f.enabled != original || !slices.Equal(f.calls, []bool{!original, original}) {
				t.Fatalf("failed save left login changed: %+v", f)
			}
		})
	}
}

func TestStartupOptionsRejectUnsupportedChanges(t *testing.T) {
	a := testApp(t)
	old := a.settings
	for _, option := range []string{"login", "background"} {
		next := a.settings
		if option == "login" {
			next.LaunchAtLogin = true
		} else {
			next.StartInTray = true
		}
		if err := a.SaveSettings(next); err == nil {
			t.Fatalf("enabled unsupported %s option", option)
		}
	}
	if a.settings != old {
		t.Fatal("rejected options changed settings")
	}
}

func TestStartupRegistrationReadFailureDoesNotWrite(t *testing.T) {
	a := testApp(t)
	f := &fakeLoginStart{readErr: errors.New("access denied")}
	a.loginStart = f
	old := a.settings
	if err := a.store.SaveSettings(old); err != nil {
		t.Fatal(err)
	}
	next := old
	next.LaunchAtLogin = true
	if err := a.SaveSettings(next); err == nil {
		t.Fatal("ignored unreadable registration")
	}
	saved, err := a.store.Settings()
	if err != nil || saved != old || a.settings != old || len(f.calls) != 0 {
		t.Fatal("wrote settings with an unknown registration state")
	}
}

func TestFailedLoginRollbackIsReported(t *testing.T) {
	a := testApp(t)
	f := &fakeLoginStart{failAt: 2}
	a.loginStart = f
	old := a.settings
	a.store.Close()
	next := old
	next.LaunchAtLogin = true
	err := a.SaveSettings(next)
	if err == nil || a.status.StartupError == "" || !f.enabled || a.settings != old {
		t.Fatalf("unrestored registration was not reported: %v, %+v", err, a.status)
	}
}
