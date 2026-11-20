package app

import (
	"context"
	"errors"

	"yap/internal/platform"
)

// Stop a sequence of permission requests when the user cancels one of them.
func (a *App) registerMissingShortcutsLocked() {
	if a.shortcut == nil {
		err := a.registerShortcut()
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return
		}
	}
	if a.profileShortcut == nil {
		a.registerProfileShortcut()
	}
}

// Called with App.mu held. Portal permission dialogs must leave snapshots,
// cancellation and shutdown responsive while preventing competing operations.
func (a *App) registerNativeShortcutLocked(value string, down, up func()) (shortcutRegistration, error) {
	if a.closing {
		return nil, context.Canceled
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithCancel(ctx)
	a.shortcutRegistrationCancel = cancel
	register := a.registerKeyContext
	if register == nil {
		register = func(ctx context.Context, value string, down, up func()) (shortcutRegistration, error) {
			return platform.RegisterContext(ctx, value, down, up)
		}
	}
	a.wg.Add(1)
	a.mu.Unlock()
	s, err := register(ctx, value, down, up)
	a.mu.Lock()
	a.wg.Done()
	a.shortcutRegistrationCancel = nil
	cancelled := ctx.Err()
	cancel()
	if a.closing || cancelled != nil {
		if s != nil {
			s.Close()
		}
		return nil, context.Canceled
	}
	return s, err
}

func (a *App) watchShortcutLocked(s shortcutRegistration, generation uint64, profile bool) {
	registration, ok := s.(interface {
		Done() <-chan struct{}
		Err() error
	})
	if !ok || registration.Done() == nil {
		return
	}
	go func() {
		<-registration.Done()
		err := registration.Err()
		if err == nil {
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.closing {
			return
		}
		if profile {
			if generation != a.profileShortcutGeneration {
				return
			}
			a.profileShortcut, a.status.ProfileShortcutError = nil, err.Error()
		} else {
			if generation != a.shortcutGeneration {
				return
			}
			a.shortcut, a.status.ShortcutError = nil, err.Error()
		}
		a.emit()
	}()
}
