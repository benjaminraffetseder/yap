package app

import (
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/models"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

// Configuration is read under one lock: a profile and the settings/text choices
// it applies must always reach the frontend as a single saved baseline.
type Configuration struct {
	Settings          storage.Settings           `json:"settings"`
	TextProcessing    textmodel.Config           `json:"textProcessing"`
	AppProfileRules   []storage.AppProfileRule   `json:"appProfileRules"`
	ProfileShortcut   string                     `json:"profileShortcut"`
	DictationProfiles []storage.DictationProfile `json:"dictationProfiles"`
	ActiveProfileID   string                     `json:"activeProfileId"`
	DefaultProfileID  string                     `json:"defaultProfileId"`
	ProfileModified   bool                       `json:"profileModified"`
	Ready             bool                       `json:"ready"`
}

type ModelCatalog struct {
	Models                 []models.Model     `json:"models"`
	TextModels             []models.TextModel `json:"textModels"`
	TextRuntimeAvailable   bool               `json:"textRuntimeAvailable"`
	RecommendedTextContext int                `json:"recommendedTextContext"`
}

type RuntimeSnapshot struct {
	BulkTextQueue          []BulkTextJob     `json:"bulkTextQueue"`
	ImportQueue            []ImportJob       `json:"importQueue"`
	RecordingSaveHistory   bool              `json:"recordingSaveHistory"`
	LatestResult           *TemporaryResult  `json:"latestResult"`
	Diagnostic             DiagnosticResult  `json:"diagnostic"`
	MicrophoneTested       bool              `json:"microphoneTested"`
	ShortcutTested         bool              `json:"shortcutTested"`
	Status                 Status            `json:"status"`
	History                []storage.Session `json:"history"`
	DataDir                string            `json:"dataDir"`
	FloatingIndicator      bool              `json:"floatingIndicator"`
	LaunchAtLoginAvailable bool              `json:"launchAtLoginAvailable"`
	StartInTrayAvailable   bool              `json:"startInTrayAvailable"`
}

func (a *App) GetConfiguration() (Configuration, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return Configuration{}, err
	}
	return a.configurationLocked(), nil
}

func (a *App) configurationLocked() Configuration {
	config, _ := textmodel.Normalize(a.textConfig)
	modified := false
	for _, p := range a.profileLibrary.Profiles {
		if p.ID == a.profileLibrary.ActiveID {
			modified = !p.Matches(a.settings, a.textConfig)
		}
	}
	return Configuration{Settings: a.settings, TextProcessing: config, AppProfileRules: append([]storage.AppProfileRule{}, a.profileLibrary.AppRules...), ProfileShortcut: a.profileLibrary.ProfileShortcut, DictationProfiles: append([]storage.DictationProfile{}, a.profileLibrary.Profiles...), ActiveProfileID: a.profileLibrary.ActiveID, DefaultProfileID: a.profileLibrary.DefaultID, ProfileModified: modified, Ready: speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath}) == nil}
}

func (a *App) GetVocabulary() ([]vocabulary.Entry, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return nil, err
	}
	return a.vocabularyLocked(), nil
}

func (a *App) vocabularyLocked() []vocabulary.Entry {
	entries, err := vocabulary.Normalize(a.vocabulary)
	if err != nil {
		// Preserve editable legacy conflicts without sharing slices with the caller.
		entries = make([]vocabulary.Entry, len(a.vocabulary))
		for i, entry := range a.vocabulary {
			entries[i] = entry
			entries[i].Aliases = append([]string{}, entry.Aliases...)
		}
	}
	return entries
}

func (a *App) GetModelCatalog() (ModelCatalog, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return ModelCatalog{}, err
	}
	return a.modelCatalogLocked(), nil
}

func (a *App) modelCatalogLocked() ModelCatalog {
	return ModelCatalog{Models: models.List(a.store.Dir), TextModels: models.ListTextModels(a.store.Dir), TextRuntimeAvailable: models.TextRuntimeAvailable(), RecommendedTextContext: models.RecommendedTextContext()}
}

func (a *App) GetRuntimeSnapshot() (RuntimeSnapshot, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.runtimeSnapshotLocked()
}

func (a *App) runtimeSnapshotLocked() (RuntimeSnapshot, error) {
	if err := a.available(); err != nil {
		return RuntimeSnapshot{}, err
	}
	// Backups own the single database connection. Serve the pre-operation
	// history so refreshing the UI cannot hold a.mu and prevent cancellation.
	history := a.backupHistory
	if a.homeResultOperation {
		history = a.homeHistory
	} else if a.status.Phase != "backup" {
		var err error
		history, err = a.store.History()
		if err != nil {
			return RuntimeSnapshot{}, err
		}
	}
	if !a.homeResultOperation && a.status.Phase != "backup" {
		a.homeHistory = history
		a.updateTray()
	}
	var latest *TemporaryResult
	if a.latestResult != nil {
		copy := *a.latestResult
		copy.Outputs = append([]storage.GeneratedOutput{}, copy.Outputs...)
		if copy.Output != nil {
			output := *copy.Output
			copy.Output = &output
		}
		latest = &copy
	}

	return RuntimeSnapshot{BulkTextQueue: a.bulkTextSnapshotLocked(), ImportQueue: a.importSnapshotLocked(), RecordingSaveHistory: a.recordSettings.SaveHistory, LatestResult: latest, Diagnostic: a.diagnostic, MicrophoneTested: a.microphoneTested, ShortcutTested: a.shortcutTested, Status: a.status, History: history, DataDir: a.store.Dir, FloatingIndicator: a.indicator != nil, LaunchAtLoginAvailable: a.loginStart != nil, StartInTrayAvailable: a.tray != nil && !a.development}, nil
}
