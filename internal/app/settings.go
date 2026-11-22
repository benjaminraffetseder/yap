package app

import (
	"errors"
	"fmt"

	"yap/internal/app/preferences"
	"yap/internal/app/shortcuts"
	"yap/internal/storage"
)

func (a *App) SaveSettings(settings storage.Settings) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation before changing settings")
	}
	change, err := preferences.Prepare(a.settings, settings, a.profiles.Shortcut())
	if err != nil {
		return err
	}
	if change.NeedsMicrophoneValidation() {
		devices, err := a.microphones()
		if err != nil {
			return err
		}
		if err := change.ValidateMicrophones(devices); err != nil {
			return err
		}
	}
	old := a.settings
	if err := change.ValidateEnvironment(a.tray != nil && !a.development, a.loginStart != nil); err != nil {
		return err
	}
	previousLogin := false
	if a.loginStart != nil {
		var err error
		previousLogin, err = a.loginStart.Enabled()
		if err != nil {
			return fmt.Errorf("check launch at login: %w", err)
		}
	}
	restoreSettings := func() {
		if change.ShortcutChanged() {
			a.shortcuts.Close(shortcuts.Recording)
		}
		a.settings = old
		if a.shortcuts.Registration(shortcuts.Recording) == nil {
			a.registerShortcut()
		}
	}
	if change.ShortcutChanged() {
		a.shortcuts.Close(shortcuts.Recording)
		// Permission requests release App.mu. Keep candidate settings private
		// until registration and persistence succeed.
		registrationErr := a.registerShortcutFor(settings.Shortcut)
		if err := a.availableLocked(); err != nil {
			return err
		}
		if a.shortcuts.Registration(shortcuts.Recording) == nil {
			failure := a.status.ShortcutError
			a.settings = old
			if !shortcuts.Cancelled(registrationErr) {
				a.registerShortcut()
			}
			return fmt.Errorf("shortcut could not be registered: %s; choose another combination; your saved shortcut is unchanged", failure)
		}
	}
	// Re-enabling also refreshes the executable path after moving/updating Yap.
	loginChanged := change.UpdateLoginRegistration(a.loginStart != nil, previousLogin)
	if loginChanged {
		if err := a.loginStart.SetEnabled(settings.LaunchAtLogin); err != nil {
			restoreSettings()
			return fmt.Errorf("update launch at login: %w", err)
		}
	}
	if err := a.saveSettingsWithDefaultLocked(settings); err != nil {
		restoreSettings()
		if loginChanged {
			if rollbackErr := a.loginStart.SetEnabled(previousLogin); rollbackErr != nil {
				a.status.StartupError = "Could not restore launch-at-login registration: " + rollbackErr.Error()
				return errors.Join(err, errors.New(a.status.StartupError))
			}
		}
		return err
	}
	a.settings = settings
	if old.ModelPath != settings.ModelPath || old.WhisperPath != settings.WhisperPath {
		if err := a.releaseSpeechModelLocked(); err != nil {
			return err
		}
	}
	if change.InvalidatesDiagnostics() {
		a.diagnostic = DiagnosticResult{}
	}
	if change.MicrophoneChanged() {
		a.microphoneTested = false
	}
	if change.ShortcutChanged() {
		a.shortcutTested = false
	}
	if a.loginStart != nil {
		a.status.StartupError = ""
	}
	if a.shortcuts.Registration(shortcuts.Recording) == nil {
		a.registerShortcut()
	}
	a.pruneHistoryLocked()
	a.emitStatusLocked()
	a.event("setup:changed", []string{"configuration"})
	return nil
}
