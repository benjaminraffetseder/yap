package main

import (
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
	settings, config, id := a.settings, a.textConfig, a.profileLibrary.ActiveID
	if !external {
		return settings, config, id, nil
	}
	app := a.currentProfileApplication()
	if a.profileOverridePending && app == a.profileOverrideApp {
		return settings, config, id, nil
	}
	for _, rule := range a.profileLibrary.AppRules {
		if app != rule.ApplicationID {
			continue
		}
		for _, profile := range a.profileLibrary.Profiles {
			if profile.ID == rule.ProfileID {
				settings, config, err := a.profileConfiguration(profile)
				if err != nil {
					return settings, config, id, fmt.Errorf("automatic profile %s: %w", profile.Name, err)
				}
				return settings, config, profile.ID, nil
			}
		}
		return settings, config, id, errors.New("automatic dictation profile is unavailable; update its application rule in Settings")
	}
	return settings, config, id, nil
}

func (a *App) SaveProfileAutomation(rules []storage.AppProfileRule, shortcut string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return err
	}
	shortcut = strings.TrimSpace(shortcut)
	if shortcut != "" {
		if _, _, err := platform.ParseShortcut(shortcut); err != nil {
			return err
		}
		if platform.SameShortcut(shortcut, a.settings.Shortcut) {
			return errors.New("recording and profile cycling must use different shortcuts")
		}
	}
	library := a.profileLibrary
	library.AppRules, library.ProfileShortcut = rules, shortcut
	library, err := storage.NormalizeProfiles(library)
	if err != nil {
		return err
	}
	old := a.profileLibrary
	changed := old.ProfileShortcut != shortcut
	if changed {
		a.closeProfileShortcut()
		a.profileLibrary = library
		a.registerProfileShortcut()
		if shortcut != "" && a.profileShortcut == nil {
			failure := a.status.ProfileShortcutError
			a.profileLibrary = old
			a.registerProfileShortcut()
			a.emit()
			return fmt.Errorf("profile shortcut could not be registered: %s; your saved shortcut is unchanged", failure)
		}
	}
	if err := a.store.SaveDictationProfiles(library); err != nil {
		if changed {
			a.closeProfileShortcut()
			a.profileLibrary = old
			a.registerProfileShortcut()
		}
		return err
	}
	a.profileLibrary = library
	a.profileOverridePending = false
	a.event("setup:changed")
	return nil
}

func (a *App) closeProfileShortcut() {
	a.profileShortcutGeneration++
	if a.profileShortcut != nil {
		a.profileShortcut.Close()
		a.profileShortcut = nil
	}
}

func (a *App) registerProfileShortcut() {
	a.profileShortcutGeneration++
	generation := a.profileShortcutGeneration
	a.status.ProfileShortcutError = ""
	if a.profileLibrary.ProfileShortcut == "" {
		return
	}
	register := a.registerKey
	if register == nil {
		register = func(value string, down, up func()) (shortcutRegistration, error) {
			return platform.Register(value, down, up)
		}
	}
	s, err := register(a.profileLibrary.ProfileShortcut, func() {
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
		return
	}
	a.profileShortcut = s
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
	profiles := a.profileLibrary.Profiles
	if len(profiles) == 0 {
		return "", errors.New("create a dictation profile in Settings first")
	}
	app := a.currentProfileApplication()
	id := a.profileLibrary.ActiveID
	if !a.profileOverridePending || a.profileOverrideApp != app {
		for _, rule := range a.profileLibrary.AppRules {
			if rule.ApplicationID == app {
				id = rule.ProfileID
			}
		}
	}
	index := -1
	for i, p := range profiles {
		if p.ID == id {
			index = i
		}
	}
	for offset := 1; offset <= len(profiles); offset++ {
		p := profiles[(index+offset)%len(profiles)]
		if _, _, err := a.profileConfiguration(p); err != nil {
			continue
		}
		if err := a.applyDictationProfileLocked(p.ID); err != nil {
			return "", err
		}
		a.profileOverrideApp, a.profileOverridePending = app, true
		return p.Name, nil
	}
	return "", errors.New("no available profiles; check speech models and prompts in Settings")
}
