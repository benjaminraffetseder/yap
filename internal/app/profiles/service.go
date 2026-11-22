// Package profiles owns saved dictation profiles and application selection policy.
// Its caller serializes access and owns operation availability and desktop effects.
package profiles

import (
	"errors"
	"fmt"
	"reflect"
	"strings"

	"github.com/google/uuid"
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/platform"
	"yap/internal/storage"
)

// Service's zero value is an empty profile library. Persistence receives the
// current store so construction does not bind it before application startup.
type Service struct {
	library         storage.ProfileLibrary
	overrideApp     string
	overridePending bool
}

// Selection captures profile settings without changing unrelated preferences.
type Selection struct {
	Settings storage.Settings
	Config   textmodel.Config
	ID, Name string
}

// Automation is a validated candidate, kept separate from committed state while
// the application obtains permission for its native shortcut.
type Automation struct{ library storage.ProfileLibrary }

func (a Automation) Shortcut() string { return a.library.ProfileShortcut }

func (s *Service) Load(store *storage.Store) error {
	library, err := store.DictationProfiles()
	if err != nil {
		return err
	}
	s.library = library
	return nil
}

// Library returns detached slices and connections so snapshots cannot mutate service state.
func (s *Service) Library() storage.ProfileLibrary {
	library := s.library
	library.Profiles = append([]storage.DictationProfile(nil), library.Profiles...)
	for i, profile := range library.Profiles {
		if profile.TextModel != nil {
			connection := *profile.TextModel
			library.Profiles[i].TextModel = &connection
		}
	}
	library.AppRules = append([]storage.AppProfileRule(nil), library.AppRules...)
	return library
}

func (s *Service) ActiveID() string { return s.library.ActiveID }
func (s *Service) Shortcut() string { return s.library.ProfileShortcut }

func (s *Service) ProfileName(id string) string {
	for _, p := range s.library.Profiles {
		if p.ID == id {
			return p.Name
		}
	}
	return ""
}

func (s *Service) EnsureDefault(store *storage.Store, settings storage.Settings, config textmodel.Config) error {
	library, changed, err := storage.WithDefaultProfile(s.library, settings, config)
	if err != nil || !changed {
		return err
	}
	if err := store.SaveDictationProfiles(library); err != nil {
		return err
	}
	s.library = library
	return nil
}

// SaveSettings keeps first-run baseline creation atomic with its source settings.
func (s *Service) SaveSettings(store *storage.Store, settings storage.Settings, config textmodel.Config) error {
	return s.SaveSettingsWithShortcut(store, settings, config, nil)
}

func (s *Service) SaveSettingsWithShortcut(store *storage.Store, settings storage.Settings, config textmodel.Config, shortcut *string) error {
	library, changed, err := storage.WithDefaultProfile(s.library, settings, config)
	if err != nil {
		return err
	}
	if shortcut != nil {
		library.ProfileShortcut = *shortcut
	} else if !changed {
		return store.SaveSettings(settings)
	}
	if err := store.ApplyDictationProfile(library, settings, config); err != nil {
		return err
	}
	s.library = library
	if shortcut != nil {
		s.ClearOverride()
	}
	return nil
}

// FinishSetup commits the final setup configuration, its Default baseline, and
// the new named selection together. A value-identical stable profile ID makes a
// retry after a successful commit safe without overwriting a different profile.
func (s *Service) FinishSetup(store *storage.Store, profile storage.DictationProfile, settings storage.Settings, config textmodel.Config) (Selection, error) {
	settings.SetupComplete = true
	normalized, err := textmodel.Normalize(config)
	if err != nil {
		return Selection{}, err
	}
	config = normalized
	library, _, err := storage.WithDefaultProfile(s.library, settings, config)
	if err != nil {
		return Selection{}, err
	}
	if profile.ID == "" {
		return Selection{}, errors.New("setup profile identifier is required")
	}
	if profile.ID == library.DefaultID {
		return Selection{}, errors.New("the setup profile must be separate from Default")
	}
	found := false
	var existingProfile storage.DictationProfile
	for i, existing := range library.Profiles {
		if existing.ID == profile.ID {
			existingProfile, found = existing, true
			library.Profiles[i] = profile
		}
	}
	if !found {
		library.Profiles = append(library.Profiles, profile)
	}
	library.ActiveID = profile.ID
	library, err = storage.NormalizeProfiles(library)
	if err != nil {
		return Selection{}, err
	}
	for _, saved := range library.Profiles {
		if saved.ID != profile.ID {
			continue
		}
		if found && !reflect.DeepEqual(existingProfile, saved) {
			return Selection{}, errors.New("setup profile identifier already belongs to a different profile")
		}
		selection, err := configuration(saved, settings, config)
		if err != nil {
			return Selection{}, err
		}
		if err := store.ApplyDictationProfile(library, selection.Settings, selection.Config); err != nil {
			return Selection{}, err
		}
		s.library = library
		s.ClearOverride()
		return selection, nil
	}
	return Selection{}, errors.New("setup profile was not saved")
}

func (s *Service) Save(store *storage.Store, profile storage.DictationProfile, config textmodel.Config) (storage.DictationProfile, error) {
	if profile.ID == "" {
		profile.ID = uuid.NewString()
	}
	library, err := storage.NormalizeProfiles(s.library)
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
		if _, err := config.Recipe(profile.AutoPromptID); err != nil {
			return storage.DictationProfile{}, err
		}
	}
	if err := store.SaveDictationProfiles(library); err != nil {
		return storage.DictationProfile{}, err
	}
	s.library = library
	for _, p := range s.Library().Profiles {
		if p.ID == profile.ID {
			return p, nil
		}
	}
	return storage.DictationProfile{}, errors.New("profile was not saved")
}

func (s *Service) Delete(store *storage.Store, id string) error {
	if id != "" && id == s.library.DefaultID {
		return errors.New("the Default profile cannot be deleted")
	}
	library := s.library
	library.Profiles = []storage.DictationProfile{}
	library.AppRules = nil
	for _, rule := range s.library.AppRules {
		if rule.ProfileID != id {
			library.AppRules = append(library.AppRules, rule)
		}
	}
	found := false
	for _, p := range s.library.Profiles {
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
	if err := store.SaveDictationProfiles(library); err != nil {
		return err
	}
	s.library = library
	return nil
}

func configuration(p storage.DictationProfile, settings storage.Settings, config textmodel.Config) (Selection, error) {
	settings.ModelPath, settings.Language, settings.CleanText = p.ModelPath, p.Language, p.CleanText
	if p.TextModel != nil {
		config.Provider, config.ContextLength = p.TextModel.Provider, p.TextModel.ContextLength
		config.Enabled, config.Endpoint, config.Model = p.TextModel.Enabled, p.TextModel.Endpoint, p.TextModel.Model
	}
	config.AutoPromptID = p.AutoPromptID
	selection := Selection{Settings: settings, Config: config, ID: p.ID, Name: p.Name}
	if err := speech.Validate(speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath}); err != nil {
		return selection, fmt.Errorf("profile speech model is unavailable; install or repair it in Models: %w", err)
	}
	if speech.Kind(settings.ModelPath) == "moonshine" && settings.Language != "auto" && settings.Language != "en" {
		return selection, errors.New("this Moonshine model supports English only; edit the profile language or speech model")
	}
	if p.AutoPromptID != "" {
		if !config.Enabled {
			return selection, errors.New("enable and configure your local text model in Prompts before using this profile")
		}
		if _, err := config.Recipe(p.AutoPromptID); err != nil {
			return selection, err
		}
	}
	normalized, err := textmodel.Normalize(config)
	if err != nil {
		return selection, err
	}
	selection.Config = normalized
	return selection, nil
}

func (s *Service) Apply(store *storage.Store, id string, settings storage.Settings, config textmodel.Config) (Selection, error) {
	for _, p := range s.library.Profiles {
		if p.ID != id {
			continue
		}
		selection, err := configuration(p, settings, config)
		if err != nil {
			return Selection{}, err
		}
		library := s.library
		library.ActiveID = id
		if err := store.ApplyDictationProfile(library, selection.Settings, selection.Config); err != nil {
			return Selection{}, err
		}
		s.library = library
		s.ClearOverride()
		return selection, nil
	}
	return Selection{}, errors.New("dictation profile no longer exists")
}

// Resolve changes captured settings only. Manual settings remain the fallback
// for unassigned applications, imports and recording started in the webview.
func (s *Service) Resolve(external bool, application string, settings storage.Settings, config textmodel.Config) (Selection, error) {
	selection := Selection{Settings: settings, Config: config, ID: s.library.ActiveID}
	if !external || s.overridePending && application == s.overrideApp {
		return selection, nil
	}
	for _, rule := range s.library.AppRules {
		if application != rule.ApplicationID {
			continue
		}
		for _, p := range s.library.Profiles {
			if p.ID == rule.ProfileID {
				selected, err := configuration(p, settings, config)
				if err != nil {
					selected.ID = selection.ID
					return selected, fmt.Errorf("automatic profile %s: %w", p.Name, err)
				}
				return selected, nil
			}
		}
		return selection, errors.New("automatic dictation profile is unavailable; update its application rule in Settings")
	}
	return selection, nil
}

func (s *Service) PrepareAutomation(rules []storage.AppProfileRule, shortcut, recordingShortcut string) (Automation, error) {
	shortcut = strings.TrimSpace(shortcut)
	if shortcut != "" {
		if _, _, err := platform.ParseShortcut(shortcut); err != nil {
			return Automation{}, err
		}
		if platform.SameShortcut(shortcut, recordingShortcut) {
			return Automation{}, errors.New("recording and profile cycling must use different shortcuts")
		}
	}
	library := s.library
	library.AppRules, library.ProfileShortcut = rules, shortcut
	library, err := storage.NormalizeProfiles(library)
	if err != nil {
		return Automation{}, err
	}
	return Automation{library: library}, nil
}

func (s *Service) SaveAutomation(store *storage.Store, automation Automation) error {
	if err := store.SaveDictationProfiles(automation.library); err != nil {
		return err
	}
	s.library = automation.library
	s.ClearOverride()
	return nil
}

func (s *Service) Cycle(store *storage.Store, application string, settings storage.Settings, config textmodel.Config) (Selection, error) {
	profiles := s.library.Profiles
	if len(profiles) == 0 {
		return Selection{}, errors.New("create a dictation profile in Settings first")
	}
	id := s.library.ActiveID
	if !s.overridePending || s.overrideApp != application {
		for _, rule := range s.library.AppRules {
			if rule.ApplicationID == application {
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
		if _, err := configuration(p, settings, config); err != nil {
			continue
		}
		selection, err := s.Apply(store, p.ID, settings, config)
		if err != nil {
			return Selection{}, err
		}
		s.overrideApp, s.overridePending = application, true
		return selection, nil
	}
	return Selection{}, errors.New("no available profiles; check speech models and prompts in Settings")
}

// ClearOverride consumes a successful external recording's one-use selection.
func (s *Service) ClearOverride() { s.overridePending = false }
