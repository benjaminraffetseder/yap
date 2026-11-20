package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"yap/internal/indicator"
	textmodel "yap/internal/inference/text"
	"yap/internal/platform"
	"yap/internal/storage"
)

func (a *App) GetProfileApplications() ([]platform.Application, error) {
	return platform.Applications()
}

func (a *App) currentProfileApplication() string {
	if a.activeApplication != nil {
		return strings.ToLower(a.activeApplication())
	}
	return platform.ActiveApplication()
}

// Rules affect the captured settings only. The manual profile and its unsaved
// modifications remain the fallback for unassigned apps, imports and UI recording.
func (a *App) recordingConfiguration(external bool) (storage.Settings, textmodel.Config, string, error) {
	application := ""
	if external {
		application = a.currentProfileApplication()
	}
	selection, err := a.profiles.Resolve(external, application, a.settings, a.textConfig)
	return selection.Settings, selection.Config, selection.ID, err
}

func (a *App) SaveProfileAutomation(rules []storage.AppProfileRule, shortcut string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return err
	}
	automation, err := a.profiles.PrepareAutomation(rules, shortcut, a.settings.Shortcut)
	if err != nil {
		return err
	}
	shortcut = automation.Shortcut()
	changed := a.profiles.Shortcut() != shortcut
	if changed {
		a.closeProfileShortcut()
		registrationErr := a.registerProfileShortcutFor(shortcut)
		if err := a.available(); err != nil {
			return err
		}
		if shortcut != "" && a.profileShortcut == nil {
			failure := a.status.ProfileShortcutError
			if !errors.Is(registrationErr, context.Canceled) && !errors.Is(registrationErr, context.DeadlineExceeded) {
				a.registerProfileShortcut()
			}
			a.emit()
			return fmt.Errorf("profile shortcut could not be registered: %s; your saved shortcut is unchanged", failure)
		}
	}
	if err := a.profiles.SaveAutomation(a.store, automation); err != nil {
		if changed {
			a.closeProfileShortcut()
			a.registerProfileShortcut()
		}
		return err
	}
	a.event("setup:changed", []string{"configuration"})
	return nil
}

func (a *App) closeProfileShortcut() {
	a.profileShortcutGeneration++
	if a.profileShortcut != nil {
		a.profileShortcut.Close()
		a.profileShortcut = nil
	}
}

func (a *App) registerProfileShortcut() error {
	return a.registerProfileShortcutFor(a.profiles.Shortcut())
}

func (a *App) registerProfileShortcutFor(value string) error {
	a.profileShortcutGeneration++
	generation := a.profileShortcutGeneration
	a.status.ProfileShortcutError = ""
	if value == "" {
		return nil
	}
	register := a.registerKey
	if register == nil {
		register = func(value string, down, up func()) (shortcutRegistration, error) {
			return a.registerNativeShortcutLocked(value, down, up)
		}
	}
	s, err := register(value, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.closing || generation != a.profileShortcutGeneration || !a.settings.SetupComplete || a.busy() || a.textJobID != "" {
			return
		}
		name, err := a.cycleDictationProfileLocked()
		if err != nil {
			a.event("profile:changed", "", err.Error())
			if a.indicator != nil {
				a.indicator.Update(indicator.State{Phase: "profile", Message: "Open Yap to check profiles"})
			}
			return
		}
		a.event("profile:changed", name, "")
		if a.indicator != nil {
			a.indicator.Update(indicator.State{Phase: "profile", Message: "Profile: " + name})
		}
	}, func() {})
	if err != nil {
		a.status.ProfileShortcutError = err.Error()
		return err
	}
	a.profileShortcut = s
	a.watchShortcutLocked(s, generation, true)
	return nil
}

func (a *App) CycleDictationProfile() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return err
	}
	_, err := a.cycleDictationProfileLocked()
	return err
}

func (a *App) cycleDictationProfileLocked() (string, error) {
	selection, err := a.profiles.Cycle(a.store, a.currentProfileApplication(), a.settings, a.textConfig)
	if err != nil {
		return "", err
	}
	a.publishProfileLocked(selection)
	return selection.Name, nil
}
