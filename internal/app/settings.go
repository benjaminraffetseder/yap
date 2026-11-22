package app

import (
	"errors"
	"fmt"
	"strings"

	"yap/internal/app/preferences"
	"yap/internal/app/shortcuts"
	"yap/internal/platform"
	"yap/internal/storage"
)

func (a *App) SaveSettings(settings storage.Settings) error {
	return a.saveSettings(settings, nil)
}

// SwapSettingsShortcuts saves a reciprocal exchange that neither individual
// shortcut setter could register while the other still holds its old binding.
func (a *App) SwapSettingsShortcuts(settings storage.Settings, profileShortcut string) error {
	profileShortcut = strings.TrimSpace(profileShortcut)
	return a.saveSettings(settings, &profileShortcut)
}

func (a *App) saveSettings(settings storage.Settings, swap *string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation before changing settings")
	}
	profileShortcut := a.profiles.Shortcut()
	if swap != nil {
		if err := a.profilesAvailableLocked(); err != nil {
			return err
		}
		if settings.Shortcut == a.settings.Shortcut && *swap == profileShortcut {
			// A retry may follow a committed swap whose receipt was lost.
			swap = nil
		} else if !platform.SameShortcut(settings.Shortcut, profileShortcut) || !platform.SameShortcut(*swap, a.settings.Shortcut) {
			return errors.New("saved shortcuts changed before the swap; review the current settings")
		} else {
			profileShortcut = *swap
		}
	}
	change, err := preferences.Prepare(a.settings, settings, profileShortcut)
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
		if swap != nil {
			a.closeProfileShortcut()
		}
		if change.ShortcutChanged() {
			a.shortcuts.Close(shortcuts.Recording)
		}
		if swap != nil {
			a.registerMissingShortcutsLocked()
		} else if a.shortcuts.Registration(shortcuts.Recording) == nil {
			a.registerShortcut()
		}
	}
	if change.ShortcutChanged() {
		if swap != nil {
			a.closeProfileShortcut()
		}
		// Permission requests release App.mu. Keep both candidate values private
		// until all candidate bindings and the storage transaction succeed.
		registrationErr := a.registerShortcutFor(settings.Shortcut)
		if registrationErr == nil && swap != nil {
			registrationErr = a.registerProfileShortcutFor(*swap)
		}
		if err := a.availableLocked(); err != nil {
			return err
		}
		if registrationErr == nil && swap != nil && a.shortcuts.Registration(shortcuts.Profile) == nil {
			registrationErr = errors.New("profile shortcut unavailable")
		}
		if registrationErr != nil || a.shortcuts.Registration(shortcuts.Recording) == nil {
			failure := a.status.ShortcutError
			if registrationErr != nil {
				failure = registrationErr.Error()
			}
			if shortcuts.Cancelled(registrationErr) {
				// Release any candidate already installed, without opening a
				// new permission dialog after cancellation.
				a.shortcuts.Close(shortcuts.Recording)
				if swap != nil {
					a.closeProfileShortcut()
					a.status.ShortcutError = failure
					a.status.ProfileShortcutError = failure
				}
			} else {
				restoreSettings()
			}
			a.emitStatusLocked()
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
	if err := a.profiles.SaveSettingsWithShortcut(a.store, settings, a.textConfig, swap); err != nil {
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
