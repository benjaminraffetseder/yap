package app

import (
	"errors"
	"fmt"
	"time"

	"yap/internal/app/shortcuts"
)

type shortcutRegistration = shortcuts.Registration

// Release the native registration so even the existing shortcut reaches the
// webview without starting dictation. A lease restores it if the webview is lost.
func (a *App) BeginShortcutCapture() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return "", err
	}
	if a.busyLocked() {
		return "", errors.New("finish the current operation before recording a shortcut")
	}
	return a.beginShortcutCaptureLocked(time.Minute), nil
}

func (a *App) beginShortcutCaptureLocked(lease time.Duration) string {
	token := a.shortcuts.BeginCapture(lease, func(token string) {
		a.mu.Lock()
		defer a.mu.Unlock()
		_ = a.endShortcutCaptureLocked(token)
	})
	a.updateTrayLocked()
	return token
}

func (a *App) EndShortcutCapture(token string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.endShortcutCaptureLocked(token)
}

func (a *App) endShortcutCaptureLocked(token string) error {
	if !a.shortcuts.EndCapture(token) {
		return nil
	}
	if a.closing {
		return nil
	}
	a.registerMissingShortcutsLocked()
	a.emitStatusLocked()
	a.event("shortcut:capture-ended", token)
	if a.status.ShortcutError != "" {
		return fmt.Errorf("could not restore the saved shortcut: %s; choose another combination and save settings", a.status.ShortcutError)
	}
	if a.status.ProfileShortcutError != "" {
		return fmt.Errorf("could not restore the profile shortcut: %s", a.status.ProfileShortcutError)
	}
	return nil
}
