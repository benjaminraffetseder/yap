package main

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"yap/internal/inference/speech"
	"yap/internal/storage"
)

func (a *App) ensureDefaultProfileLocked() error {
	library, changed, err := storage.WithDefaultProfile(a.profileLibrary, a.settings, a.textConfig)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	if err := a.store.SaveDictationProfiles(library); err != nil {
		return err
	}
	a.profileLibrary = library
	return nil
}

// Keep first-run baseline creation atomic with the settings that produced it.
func (a *App) saveSettingsWithDefaultLocked(settings storage.Settings) error {
	library, changed, err := storage.WithDefaultProfile(a.profileLibrary, settings, a.textConfig)
	if err != nil {
		return err
	}
	if !changed {
		return a.store.SaveSettings(settings)
	}
	if err := a.store.ApplyDictationProfile(library, settings, a.textConfig); err != nil {
		return err
	}
	a.profileLibrary = library
	return nil
}

func (a *App) profilesAvailableLocked() error {
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() || a.textJobID != "" {
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
	if profile.ID == "" {
		profile.ID = uuid.NewString()
	}
	library, err := storage.NormalizeProfiles(a.profileLibrary)
	if err != nil {
		return storage.DictationProfile{}, err
	}
	found := false
	for i, p := range library.Profiles {
		if p.ID == profile.ID {
			if p.ID == library.DefaultID && strings.TrimSpace(profile.Name) != p.Name {
				return storage.DictationProfile{}, errors.New("the Default profile cannot be renamed")
			}
			library.Profiles[i], found = profile, true
		}
	}
	if !found {
		library.Profiles = append(library.Profiles, profile)
	}
	library, err = storage.NormalizeProfiles(library)
	if err != nil {
		return storage.DictationProfile{}, err
	}
	if profile.AutoPromptID != "" {
		if _, err := a.textConfig.Prompt(profile.AutoPromptID); err != nil {
			return storage.DictationProfile{}, err
		}
	}
	if err := a.store.SaveDictationProfiles(library); err != nil {
		return storage.DictationProfile{}, err
	}
	a.profileLibrary = library
	a.event("setup:changed")
	for _, p := range library.Profiles {
		if p.ID == profile.ID {
			return p, nil
		}
	}
	return storage.DictationProfile{}, errors.New("profile was not saved")
}

func (a *App) DeleteDictationProfile(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return err
	}
	if id != "" && id == a.profileLibrary.DefaultID {
		return errors.New("the Default profile cannot be deleted")
	}
	library := storage.ProfileLibrary{DefaultID: a.profileLibrary.DefaultID, ActiveID: a.profileLibrary.ActiveID, Profiles: []storage.DictationProfile{}}
	found := false
	for _, p := range a.profileLibrary.Profiles {
		if p.ID == id {
			found = true
		} else {
			library.Profiles = append(library.Profiles, p)
		}
	}
	if !found {
		return errors.New("dictation profile no longer exists")
	}
	if library.ActiveID == id {
		library.ActiveID = library.DefaultID
	}
	if err := a.store.SaveDictationProfiles(library); err != nil {
		return err
	}
	a.profileLibrary = library
	a.event("setup:changed")
	return nil
}

func (a *App) ApplyDictationProfile(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return err
	}
	for _, p := range a.profileLibrary.Profiles {
		if p.ID != id {
			continue
		}
		settings, config := a.settings, a.textConfig
		settings.ModelPath, settings.Language, settings.CleanText = p.ModelPath, p.Language, p.CleanText
		config.AutoPromptID = p.AutoPromptID
		if err := speech.Validate(speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath}); err != nil {
			return fmt.Errorf("profile speech model is unavailable; install or repair it in Models: %w", err)
		}
		if speech.Kind(settings.ModelPath) == "moonshine" && settings.Language != "auto" && settings.Language != "en" {
			return errors.New("this Moonshine model supports English only; edit the profile language or speech model")
		}
		if p.AutoPromptID != "" && !config.Enabled {
			return errors.New("enable and configure your local text model in Prompts before using this profile")
		}
		library := a.profileLibrary
		library.ActiveID = id
		if err := a.store.ApplyDictationProfile(library, settings, config); err != nil {
			return err
		}
		a.profileLibrary, a.settings, a.textConfig = library, settings, config
		a.diagnostic = DiagnosticResult{}
		a.event("setup:changed")
		return nil
	}
	return errors.New("dictation profile no longer exists")
}
