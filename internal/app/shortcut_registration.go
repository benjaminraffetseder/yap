package app

import (
	"context"

	"yap/internal/app/shortcuts"
	"yap/internal/platform"
)

// Stop a sequence of permission requests when the user cancels one of them.
func (a *App) registerMissingShortcutsLocked() {
	a.shortcuts.RegisterMissing(a.settings.Shortcut, a.profiles.Shortcut(), func(kind shortcuts.Kind, value string) error {
		if kind == shortcuts.Profile {
			return a.registerProfileShortcutFor(value)
		}
		return a.registerShortcutFor(value)
	})
}

func (a *App) createShortcutLocked(value string, down, up func()) (shortcutRegistration, error) {
	if a.registerKey != nil {
		return a.registerKey(value, down, up)
	}
	return a.registerNativeShortcutLocked(value, down, up)
}

func (a *App) shortcutCallback(attempt shortcuts.Attempt, callback func()) func() {
	return func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.shortcuts.Current(attempt) {
			callback()
		}
	}
}

// Called with App.mu held. Portal permission dialogs must leave snapshots,
// cancellation and shutdown responsive while preventing competing operations.
func (a *App) registerNativeShortcutLocked(value string, down, up func()) (shortcutRegistration, error) {
	if a.closing {
		return nil, context.Canceled
	}
	permission, err := a.shortcuts.BeginRegistration(a.ctx)
	if err != nil {
		return nil, err
	}
	register := a.registerKeyContext
	if register == nil {
		register = func(ctx context.Context, value string, down, up func()) (shortcutRegistration, error) {
			return platform.RegisterContext(ctx, value, down, up)
		}
	}
	a.wg.Add(1)
	a.mu.Unlock()
	s, err := register(permission.Context(), value, down, up)
	a.mu.Lock()
	a.wg.Done()
	return a.shortcuts.FinishRegistration(permission, s, err)
}

func (a *App) watchShortcutLocked(loss *shortcuts.Loss) {
	if loss == nil {
		return
	}
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		err := loss.Wait()
		if err == nil {
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.closing || !a.shortcuts.Lost(loss, err) {
			return
		}
		if loss.Kind() == shortcuts.Profile {
			a.status.ProfileShortcutError = err.Error()
		} else {
			a.status.ShortcutError = err.Error()
		}
		a.emitStatusLocked()
	}()
}
