package app

import (
	"errors"

	"yap/internal/app/profiles"
	"yap/internal/app/textprocessing"
	"yap/internal/storage"
)

func (a *App) ensureDefaultProfileLocked() error {
	return a.profiles.EnsureDefault(a.store, a.settings, a.textConfig)
}

func (a *App) saveSettingsWithDefaultLocked(settings storage.Settings) error {
	return a.profiles.SaveSettings(a.store, settings, a.textConfig)
}

func (a *App) profilesAvailableLocked() error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() || a.textJobID != "" {
		return errors.New("finish the current operation before changing dictation profiles")
	}
	return nil
}

func (a *App) SaveDictationProfile(profile storage.DictationProfile) (storage.DictationProfile, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return storage.DictationProfile{}, err
	}
	profile, err := a.profiles.Save(a.store, profile, a.textConfig)
	if err != nil {
		return storage.DictationProfile{}, err
	}
	a.event("setup:changed", []string{"configuration"})
	return profile, nil
}

func (a *App) DeleteDictationProfile(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return err
	}
	if err := a.profiles.Delete(a.store, id); err != nil {
		return err
	}
	a.event("setup:changed", []string{"configuration"})
	return nil
}

func (a *App) ApplyDictationProfile(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return err
	}
	selection, err := a.profiles.Apply(a.store, id, a.settings, a.textConfig)
	if err != nil {
		return err
	}
	return a.publishProfileLocked(selection)
}

func (a *App) publishProfileLocked(selection profiles.Selection) error {
	connectionChanged := textprocessing.ConnectionChanged(a.textConfig, selection.Config)
	speechChanged := a.settings.ModelPath != selection.Settings.ModelPath || a.settings.WhisperPath != selection.Settings.WhisperPath
	a.settings, a.textConfig = selection.Settings, selection.Config
	if speechChanged {
		if err := a.releaseSpeechModelLocked(); err != nil {
			return err
		}
	}
	if connectionChanged {
		a.releaseTextModel()
	}
	a.diagnostic = DiagnosticResult{}
	a.updateTrayLocked()
	a.event("setup:changed", []string{"configuration"})
	a.pumpQueuesLocked()
	return nil
}
