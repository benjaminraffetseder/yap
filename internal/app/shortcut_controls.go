package app

import "yap/internal/app/shortcuts"

func (a *App) registerShortcut() error {
	return a.registerShortcutFor(a.settings.Shortcut)
}

func (a *App) registerShortcutFor(value string) error {
	loss, err := a.shortcuts.Register(shortcuts.Recording, value, func(attempt shortcuts.Attempt) (shortcutRegistration, error) {
		down := a.shortcutCallback(attempt, a.hotkeyDownLocked)
		up := a.shortcutCallback(attempt, a.hotkeyUpLocked)
		return a.createShortcutLocked(value, down, up)
	})
	if err != nil {
		a.status.ShortcutError = err.Error()
		return err
	}
	a.watchShortcutLocked(loss)
	a.status.ShortcutError = ""
	return nil
}
func (a *App) hotkeyDown() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.hotkeyDownLocked()
}
func (a *App) hotkeyDownLocked() {
	switch a.shortcuts.Down(a.shortcutKeyStateLocked()) {
	case shortcuts.Tested:
		a.shortcutTested = true
		a.event("setup:changed")
	case shortcuts.Stop:
		a.stopRecordingLocked()
	case shortcuts.Start:
		if err := a.startRecordingLocked(true); err != nil {
			a.failLocked(err)
		}
	}
}
func (a *App) hotkeyUp() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.hotkeyUpLocked()
}
func (a *App) hotkeyUpLocked() {
	if a.shortcuts.Up(a.shortcutKeyStateLocked()) == shortcuts.Stop {
		a.stopRecordingLocked()
	}
}

func (a *App) shortcutKeyStateLocked() shortcuts.KeyState {
	return shortcuts.KeyState{Closing: a.closing, SetupComplete: a.settings.SetupComplete,
		Busy: a.busyLocked(), Interaction: a.settings.Interaction, Phase: a.status.Phase}
}
