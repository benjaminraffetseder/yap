package main

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type shortcutRegistration interface{ Close() }

// Release the native registration so even the existing shortcut reaches the
// webview without starting dictation. A lease restores it if the webview is lost.
func (a *App) BeginShortcutCapture() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return "", err
	}
	if a.busy() {
		return "", errors.New("finish the current operation before recording a shortcut")
	}
	token := uuid.NewString()
	a.shortcutCaptureID = token
	a.shortcutGeneration++
	if a.shortcut != nil {
		a.shortcut.Close()
		a.shortcut = nil
	}
	a.shortcutCaptureTimer = time.AfterFunc(time.Minute, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		_ = a.endShortcutCaptureLocked(token)
	})
	a.updateTray()
	return token, nil
}

func (a *App) EndShortcutCapture(token string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.endShortcutCaptureLocked(token)
}

func (a *App) endShortcutCaptureLocked(token string) error {
	if token == "" || token != a.shortcutCaptureID {
		return nil
	}
	a.shortcutCaptureID = ""
	if a.shortcutCaptureTimer != nil {
		a.shortcutCaptureTimer.Stop()
		a.shortcutCaptureTimer = nil
	}
	if a.closing {
		return nil
	}
	a.registerShortcut()
	a.emit()
	a.event("shortcut:capture-ended", token)
	if a.status.ShortcutError != "" {
		return fmt.Errorf("could not restore the saved shortcut: %s; choose another combination and save settings", a.status.ShortcutError)
	}
	return nil
}
