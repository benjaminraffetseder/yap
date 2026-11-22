package app

import (
	"errors"
	"reflect"
	"strings"

	"yap/internal/app/setup"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

// CompleteOnboarding commits the workflow and its active profile together.
// Speech and device choices must be the configuration the user actually tested;
// accepting a different model here would bypass setup validation.
func (a *App) CompleteOnboarding(profile storage.DictationProfile, config textmodel.Config) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profilesAvailableLocked(); err != nil {
		return err
	}
	if err := setup.ValidateComplete(false, a.settings, a.microphoneTested, a.shortcutTested, a.status.ShortcutError); err != nil {
		return err
	}
	if profile.ID == "" {
		return errors.New("choose an identifier for the onboarding profile")
	}
	normalized, err := textmodel.Normalize(config)
	if err != nil {
		return err
	}
	settings := a.settings
	settings.SetupComplete = true
	profile.ModelPath, profile.Language, profile.CleanText = settings.ModelPath, settings.Language, settings.CleanText
	profile.AutoPromptID = normalized.AutoPromptID
	profile.TextModel = storage.CaptureProfileTextModel(normalized)
	committedRetry := false
	if a.settings.SetupComplete && a.profiles.ActiveID() == profile.ID && reflect.DeepEqual(a.textConfig, normalized) {
		for _, saved := range a.profiles.Library().Profiles {
			if saved.ID == profile.ID && saved.Name == strings.TrimSpace(profile.Name) && saved.Matches(a.settings, normalized) {
				committedRetry = true
			}
		}
	}
	if !committedRetry && !setup.DiagnosticMatches(a.diagnostic, a.settings, a.diagnosticSettings) {
		return errors.New("try dictation successfully with your current speech settings before finishing setup")
	}
	selection, err := a.profiles.FinishSetup(a.store, profile, settings, normalized)
	if err != nil {
		return err
	}
	return a.publishProfileLocked(selection)
}
