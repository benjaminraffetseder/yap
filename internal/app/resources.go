package app

import (
	"yap/internal/app/modelmanagement"
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

type Snapshot struct {
	TextModels             []models.TextModel         `json:"textModels"`
	TextRuntimeAvailable   bool                       `json:"textRuntimeAvailable"`
	RecommendedTextContext int                        `json:"recommendedTextContext"`
	BulkTextQueue          []BulkTextJob              `json:"bulkTextQueue"`
	ImportQueue            []ImportJob                `json:"importQueue"`
	AppProfileRules        []storage.AppProfileRule   `json:"appProfileRules"`
	ProfileShortcut        string                     `json:"profileShortcut"`
	DictationProfiles      []storage.DictationProfile `json:"dictationProfiles"`
	ActiveProfileID        string                     `json:"activeProfileId"`
	DefaultProfileID       string                     `json:"defaultProfileId"`
	ProfileModified        bool                       `json:"profileModified"`
	RecordingSaveHistory   bool                       `json:"recordingSaveHistory"`
	LatestResult           *TemporaryResult           `json:"latestResult"`
	TextProcessing         textmodel.Config           `json:"textProcessing"`
	Diagnostic             DiagnosticResult           `json:"diagnostic"`
	Vocabulary             []vocabulary.Entry         `json:"vocabulary"`
	MicrophoneTested       bool                       `json:"microphoneTested"`
	ShortcutTested         bool                       `json:"shortcutTested"`
	Settings               storage.Settings           `json:"settings"`
	Status                 Status                     `json:"status"`
	History                []storage.Session          `json:"history"`
	Models                 []models.Model             `json:"models"`
	DataDir                string                     `json:"dataDir"`
	Ready                  bool                       `json:"ready"`
	FloatingIndicator      bool                       `json:"floatingIndicator"`
	LaunchAtLoginAvailable bool                       `json:"launchAtLoginAvailable"`
	StartInTrayAvailable   bool                       `json:"startInTrayAvailable"`
}

type ModelCatalog = modelmanagement.ModelCatalog

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
	if err := a.availableLocked(); err != nil {
		return Configuration{}, err
	}
	return a.configurationLocked(), nil
}

func (a *App) configurationLocked() Configuration {
	config, _ := textmodel.Normalize(a.textConfig)
	library := a.profiles.Library()
	modified := false
	for _, p := range library.Profiles {
		if p.ID == library.ActiveID {
			modified = !p.Matches(a.settings, a.textConfig)
		}
	}
	return Configuration{
		Settings:          a.settings,
		TextProcessing:    config,
		AppProfileRules:   append([]storage.AppProfileRule{}, library.AppRules...),
		ProfileShortcut:   library.ProfileShortcut,
		DictationProfiles: append([]storage.DictationProfile{}, library.Profiles...),
		ActiveProfileID:   library.ActiveID,
		DefaultProfileID:  library.DefaultID,
		ProfileModified:   modified,
		Ready:             speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath}) == nil,
	}
}

func (a *App) GetVocabulary() ([]vocabulary.Entry, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
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
	if err := a.availableLocked(); err != nil {
		return ModelCatalog{}, err
	}
	return a.modelCatalogLocked(), nil
}

func (a *App) modelCatalogLocked() ModelCatalog {
	return modelmanagement.Catalog(a.store.Dir)
}

func (a *App) GetRuntimeSnapshot() (RuntimeSnapshot, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return RuntimeSnapshot{}, err
	}
	// Transient refreshes must not read or serialize the recent transcript set.
	// History consumers have focused reads; GetSnapshot keeps its legacy shape.
	return a.runtimeStateLocked([]storage.Session{}), nil
}

func (a *App) runtimeSnapshotLocked() (RuntimeSnapshot, error) {
	if err := a.availableLocked(); err != nil {
		return RuntimeSnapshot{}, err
	}
	// Backups own the single database connection. Serve the pre-operation
	// history so refreshing the UI cannot hold a.mu and prevent cancellation.
	a.legacyHistoryInUse = true
	// Only full legacy reads populate homeHistory. The first caller must wait
	// outside mu if Home owns SQLite and no full snapshot has been captured yet.
	for a.homeResultOperation && a.homeHistory == nil && !a.closing {
		if a.homeHistoryWait == nil {
			a.homeHistoryWait = make(chan struct{})
		}
		released := a.homeHistoryWait
		a.mu.Unlock()
		<-released
		a.mu.Lock()
	}
	if err := a.availableLocked(); err != nil {
		return RuntimeSnapshot{}, err
	}
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
		a.historyPresent, a.historyPresenceKnown = len(history) > 0, true
		a.updateTrayLocked()
	}
	return a.runtimeStateLocked(cloneHistory(history)), nil
}

func (a *App) runtimeStateLocked(history []storage.Session) RuntimeSnapshot {
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

	return RuntimeSnapshot{
		BulkTextQueue:          a.bulkTextSnapshotLocked(),
		ImportQueue:            a.importSnapshotLocked(),
		RecordingSaveHistory:   a.recordSettings.SaveHistory,
		LatestResult:           latest,
		Diagnostic:             a.diagnostic,
		MicrophoneTested:       a.microphoneTested,
		ShortcutTested:         a.shortcutTested,
		Status:                 a.status,
		History:                history,
		DataDir:                a.store.Dir,
		FloatingIndicator:      a.indicator != nil,
		LaunchAtLoginAvailable: a.loginStart != nil,
		StartInTrayAvailable:   a.tray != nil && !a.development,
	}
}

func (a *App) GetSnapshot() (Snapshot, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	runtime, err := a.runtimeSnapshotLocked()
	if err != nil {
		return Snapshot{}, err
	}
	config := a.configurationLocked()
	catalog := a.modelCatalogLocked()
	return Snapshot{
		TextModels:             catalog.TextModels,
		TextRuntimeAvailable:   catalog.TextRuntimeAvailable,
		RecommendedTextContext: catalog.RecommendedTextContext,
		BulkTextQueue:          runtime.BulkTextQueue,
		ImportQueue:            runtime.ImportQueue,
		AppProfileRules:        config.AppProfileRules,
		ProfileShortcut:        config.ProfileShortcut,
		DefaultProfileID:       config.DefaultProfileID,
		ProfileModified:        config.ProfileModified,
		DictationProfiles:      config.DictationProfiles,
		ActiveProfileID:        config.ActiveProfileID,
		RecordingSaveHistory:   runtime.RecordingSaveHistory,
		LatestResult:           runtime.LatestResult,
		TextProcessing:         config.TextProcessing,
		Diagnostic:             runtime.Diagnostic,
		Vocabulary:             a.vocabularyLocked(),
		MicrophoneTested:       runtime.MicrophoneTested,
		ShortcutTested:         runtime.ShortcutTested,
		Settings:               config.Settings,
		Status:                 runtime.Status,
		History:                runtime.History,
		Models:                 catalog.Models,
		DataDir:                runtime.DataDir,
		Ready:                  config.Ready,
		FloatingIndicator:      runtime.FloatingIndicator,
		LaunchAtLoginAvailable: runtime.LaunchAtLoginAvailable,
		StartInTrayAvailable:   runtime.StartInTrayAvailable,
	}, nil
}
