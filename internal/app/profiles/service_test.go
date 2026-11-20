package profiles_test

import (
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"yap/internal/app/profiles"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func profileStore(t *testing.T) (*storage.Store, storage.Settings, textmodel.Config) {
	t.Helper()
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	settings := storage.Defaults()
	settings.SetupComplete = true
	settings.WhisperPath, err = os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	settings.ModelPath = filepath.Join(store.Dir, "models", "test.bin")
	if err := os.WriteFile(settings.ModelPath, []byte("model"), 0600); err != nil {
		t.Fatal(err)
	}
	return store, settings, textmodel.Defaults()
}

func TestDefaultSettingsPersistTogetherAndSnapshotsAreDetached(t *testing.T) {
	store, settings, config := profileStore(t)
	settings.Language = "de"
	var service profiles.Service
	if err := service.SaveSettings(store, settings, config); err != nil {
		t.Fatal(err)
	}
	library := service.Library()
	if len(library.Profiles) != 1 || library.DefaultID == "" || library.ActiveID != library.DefaultID || !library.Profiles[0].Matches(settings, config) {
		t.Fatalf("default did not capture the saved configuration: %+v", library)
	}
	savedSettings, err := store.Settings()
	if err != nil || savedSettings != settings {
		t.Fatalf("settings did not persist with their baseline: %+v, %v", savedSettings, err)
	}
	savedConfig, err := store.TextProcessing()
	if err != nil || !reflect.DeepEqual(savedConfig, config) {
		t.Fatalf("text configuration did not persist with its baseline: %+v, %v", savedConfig, err)
	}
	var reloaded profiles.Service
	if err := reloaded.Load(store); err != nil || !reflect.DeepEqual(reloaded.Library(), library) {
		t.Fatalf("reloaded library differs from committed state: %+v, %v", reloaded.Library(), err)
	}
	library.Profiles[0].Name = "Changed by snapshot consumer"
	library.Profiles[0].TextModel.Model = "Changed by snapshot consumer"
	if service.ProfileName(service.ActiveID()) != "Default" || reloaded.ProfileName(reloaded.ActiveID()) != "Default" || service.Library().Profiles[0].TextModel.Model != "" || reloaded.Library().Profiles[0].TextModel.Model != "" {
		t.Fatal("snapshot mutation changed owned profile state")
	}

	// A failed first-run save must not publish a baseline without its settings.
	var failed profiles.Service
	store.Close()
	if err := failed.SaveSettings(store, settings, config); err == nil || failed.ActiveID() != "" || len(failed.Library().Profiles) != 0 {
		t.Fatalf("failed save published a default: %+v, %v", failed.Library(), err)
	}
}

func TestProfileSelectionRestoresConnectionAndPreservesSharedRecipes(t *testing.T) {
	store, settings, config := profileStore(t)
	settings.MicrophoneID = "usb-microphone"
	config.Provider, config.Enabled, config.Model = "external", true, "global-model"
	config.AutoPromptID = "cleanup"
	config.Chains = []textmodel.Chain{{ID: "chain", Name: "Chain", Steps: []textmodel.ChainStep{{ID: "first", PromptID: "cleanup", Input: "transcript"}}}}
	var err error
	config, err = textmodel.Normalize(config)
	if err != nil {
		t.Fatal(err)
	}
	var service profiles.Service
	if err := service.SaveSettings(store, settings, config); err != nil {
		t.Fatal(err)
	}
	profileConfig := config
	profileConfig.Endpoint, profileConfig.Model, profileConfig.ContextLength = "http://localhost:12434/v1", "profile-model", 4096
	profile := storage.DictationProfile{ID: "work", Name: "Work", ModelPath: settings.ModelPath, Language: "de", CleanText: true, AutoPromptID: "chain", TextModel: storage.CaptureProfileTextModel(profileConfig)}
	saved, err := service.Save(store, profile, config)
	if err != nil {
		t.Fatal(err)
	}
	profile.TextModel.Model = "caller mutation"
	saved.TextModel.Model = "returned snapshot mutation"
	if got := service.Library().Profiles[1].TextModel.Model; got != "profile-model" {
		t.Fatal("saved profile retained a caller-owned connection pointer", got)
	}
	profile = service.Library().Profiles[1]
	selection, err := service.Apply(store, profile.ID, settings, config)
	if err != nil {
		t.Fatal(err)
	}
	if selection.Config.Model != "profile-model" || selection.Config.Endpoint != "http://127.0.0.1:12434/v1" || selection.Config.ContextLength != 4096 || selection.Config.AutoPromptID != "chain" {
		t.Fatalf("profile connection was not restored: %+v", selection.Config)
	}
	if !reflect.DeepEqual(selection.Config.Prompts, config.Prompts) || !reflect.DeepEqual(selection.Config.Chains, config.Chains) {
		t.Fatal("profile application replaced shared prompts or chains")
	}
	expectedSettings := settings
	expectedSettings.ModelPath, expectedSettings.Language, expectedSettings.CleanText = profile.ModelPath, "de", true
	if selection.Settings != expectedSettings {
		t.Fatalf("profile changed unrelated settings: %+v", selection.Settings)
	}

	rules := []storage.AppProfileRule{{ApplicationID: "windows:work.exe", ApplicationName: "Work", ProfileID: profile.ID}}
	automation, err := service.PrepareAutomation(rules, "", settings.Shortcut)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SaveAutomation(store, automation); err != nil {
		t.Fatal(err)
	}
	resolved, err := service.Resolve(true, "windows:work.exe", settings, config)
	if err != nil || resolved.Config.Model != "profile-model" || resolved.Config.AutoPromptID != "chain" {
		t.Fatalf("automatic selection lost the profile connection: %+v, %v", resolved, err)
	}
	legacy, err := service.Save(store, storage.DictationProfile{ID: "legacy", Name: "Legacy", ModelPath: settings.ModelPath, Language: "en"}, config)
	if err != nil {
		t.Fatal(err)
	}
	selection, err = service.Apply(store, legacy.ID, settings, config)
	if err != nil || selection.Config.Model != "global-model" {
		t.Fatalf("legacy profile no longer inherits the global connection: %+v, %v", selection, err)
	}
	selection, err = service.Cycle(store, "windows:work.exe", settings, config)
	if err != nil || selection.ID != legacy.ID || selection.Config.Model != "global-model" {
		t.Fatalf("cycle did not use the same connection selection policy: %+v, %v", selection, err)
	}

	disabledConfig := config
	disabledConfig.Enabled = false
	disabled, err := service.Save(store, storage.DictationProfile{ID: "disabled", Name: "Disabled", ModelPath: settings.ModelPath, Language: "en", AutoPromptID: "cleanup", TextModel: storage.CaptureProfileTextModel(disabledConfig)}, config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Apply(store, disabled.ID, settings, config); err == nil || service.ActiveID() != legacy.ID {
		t.Fatal("profile with an automatic recipe used a disabled text model", err)
	}
}

func TestFinishSetupRollsBackAndRetriesStableProfileActivation(t *testing.T) {
	store, settings, config := profileStore(t)
	var service profiles.Service
	if err := service.SaveSettings(store, settings, config); err != nil {
		t.Fatal(err)
	}
	existing, err := service.Save(store, storage.DictationProfile{ID: "existing", Name: "Existing", ModelPath: settings.ModelPath, Language: "en"}, config)
	if err != nil {
		t.Fatal(err)
	}
	rules := []storage.AppProfileRule{{ApplicationID: "windows:existing.exe", ApplicationName: "Existing", ProfileID: existing.ID}}
	automation, err := service.PrepareAutomation(rules, "Ctrl+Alt+P", settings.Shortcut)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SaveAutomation(store, automation); err != nil {
		t.Fatal(err)
	}
	beforeLibrary := service.Library()
	beforeSettings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	beforeConfig, err := store.TextProcessing()
	if err != nil {
		t.Fatal(err)
	}

	finalSettings := settings
	finalSettings.SetupComplete, finalSettings.MicrophoneID = false, "finished-microphone"
	finalConfig := config
	finalConfig.Provider, finalConfig.Enabled = "external", true
	finalConfig.Endpoint, finalConfig.Model, finalConfig.AutoPromptID = "http://localhost:12434/v1", "finished-model", "cleanup"
	named := storage.DictationProfile{ID: "stable-onboarding-profile", Name: " Finished ", ModelPath: settings.ModelPath, Language: "de", CleanText: true, AutoPromptID: "summary", TextModel: storage.CaptureProfileTextModel(finalConfig)}

	control, err := sql.Open("sqlite", filepath.Join(store.Dir, "database.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := control.Exec(`CREATE TRIGGER reject_finish_setup BEFORE UPDATE ON dictation_profiles BEGIN SELECT RAISE(FAIL, 'test failure'); END;`); err != nil {
		control.Close()
		t.Fatal(err)
	}
	if _, err := service.FinishSetup(store, named, finalSettings, finalConfig); err == nil {
		control.Close()
		t.Fatal("expected setup transaction to fail")
	}
	if !reflect.DeepEqual(service.Library(), beforeLibrary) {
		t.Fatal("failed setup published an uncommitted profile library")
	}
	gotSettings, _ := store.Settings()
	gotConfig, _ := store.TextProcessing()
	gotLibrary, _ := store.DictationProfiles()
	if gotSettings != beforeSettings || !reflect.DeepEqual(gotConfig, beforeConfig) || !reflect.DeepEqual(gotLibrary, beforeLibrary) {
		t.Fatal("failed setup persisted a partial configuration", gotSettings, gotConfig, gotLibrary)
	}
	if _, err := control.Exec(`DROP TRIGGER reject_finish_setup`); err != nil {
		control.Close()
		t.Fatal(err)
	}
	if err := control.Close(); err != nil {
		t.Fatal(err)
	}

	selection, err := service.FinishSetup(store, named, finalSettings, finalConfig)
	if err != nil {
		t.Fatal(err)
	}
	if selection.ID != named.ID || selection.Name != "Finished" || !selection.Settings.SetupComplete || selection.Settings.Language != "de" || selection.Settings.MicrophoneID != "finished-microphone" || selection.Config.Model != "finished-model" || selection.Config.AutoPromptID != "summary" {
		t.Fatalf("setup returned the wrong selection: %+v", selection)
	}
	library := service.Library()
	if library.ActiveID != named.ID || library.DefaultID != beforeLibrary.DefaultID || len(library.Profiles) != len(beforeLibrary.Profiles)+1 || !reflect.DeepEqual(library.AppRules, beforeLibrary.AppRules) || library.ProfileShortcut != beforeLibrary.ProfileShortcut {
		t.Fatalf("setup did not preserve and activate the library: %+v", library)
	}
	if !reflect.DeepEqual(library.Profiles[1], beforeLibrary.Profiles[1]) {
		t.Fatal("setup changed an existing named profile")
	}
	gotSettings, _ = store.Settings()
	gotConfig, _ = store.TextProcessing()
	gotLibrary, _ = store.DictationProfiles()
	if gotSettings != selection.Settings || !reflect.DeepEqual(gotConfig, selection.Config) || !reflect.DeepEqual(gotLibrary, library) {
		t.Fatal("successful setup was not atomically durable")
	}
	if _, err := service.FinishSetup(store, named, finalSettings, finalConfig); err != nil || len(service.Library().Profiles) != len(library.Profiles) || service.ActiveID() != named.ID {
		t.Fatal("stable setup profile ID was not safe to retry", err)
	}

	beforeCollision := service.Library()
	collision := named
	collision.Language = "en"
	if _, err := service.FinishSetup(store, collision, finalSettings, finalConfig); err == nil || !reflect.DeepEqual(service.Library(), beforeCollision) {
		t.Fatal("setup overwrote a different profile with the same ID or published partial state", err)
	}
	collision = named
	collision.ID, collision.Name = "different-id", "existing"
	if _, err := service.FinishSetup(store, collision, finalSettings, finalConfig); err == nil || !reflect.DeepEqual(service.Library(), beforeCollision) {
		t.Fatal("setup accepted a profile name collision or published partial state", err)
	}
	collision = named
	collision.ID = library.DefaultID
	if _, err := service.FinishSetup(store, collision, finalSettings, finalConfig); err == nil || !reflect.DeepEqual(service.Library(), beforeCollision) {
		t.Fatal("setup replaced Default or published partial state", err)
	}
}

func TestAutomationCandidateAndFailedPersistenceKeepCommittedSelection(t *testing.T) {
	store, settings, config := profileStore(t)
	var service profiles.Service
	manual, err := service.Save(store, storage.DictationProfile{Name: "Notes", ModelPath: settings.ModelPath, Language: "en"}, config)
	if err != nil {
		t.Fatal(err)
	}
	email, err := service.Save(store, storage.DictationProfile{Name: "Email", ModelPath: settings.ModelPath, Language: "de"}, config)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := service.Apply(store, manual.ID, settings, config)
	if err != nil {
		t.Fatal(err)
	}
	settings, config = selected.Settings, selected.Config
	before := service.Library()
	rules := []storage.AppProfileRule{{ApplicationID: "windows:OUTLOOK.exe", ApplicationName: "Outlook", ProfileID: email.ID}}
	automation, err := service.PrepareAutomation(rules, " Ctrl+Alt+P ", settings.Shortcut)
	if err != nil {
		t.Fatal(err)
	}
	if automation.Shortcut() != "Ctrl+Alt+P" || !reflect.DeepEqual(service.Library(), before) {
		t.Fatal("candidate shortcut changed the committed library before permission")
	}
	saved, err := store.DictationProfiles()
	if err != nil || saved.ProfileShortcut != "" || len(saved.AppRules) != 0 {
		t.Fatalf("candidate automation was persisted early: %+v, %v", saved, err)
	}
	rules[0].ProfileID = "changed-after-preparation"
	if err := service.SaveAutomation(store, automation); err != nil {
		t.Fatal(err)
	}
	snapshot := service.Library()
	snapshot.AppRules[0].ProfileID = "changed-by-snapshot-consumer"
	resolved, err := service.Resolve(true, "windows:outlook.exe", settings, config)
	if err != nil || resolved.ID != email.ID || resolved.Settings.Language != "de" || service.ActiveID() != manual.ID {
		t.Fatalf("rule failed to select an isolated captured configuration: %+v, %v", resolved, err)
	}
	selected, err = service.Cycle(store, "windows:outlook.exe", settings, config)
	if err != nil || selected.ID != manual.ID {
		t.Fatalf("cycle did not advance from the automatic profile: %+v, %v", selected, err)
	}
	before = service.Library()
	failedAutomation, err := service.PrepareAutomation(nil, "Ctrl+Alt+Q", settings.Shortcut)
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	if err := service.SaveAutomation(store, failedAutomation); err == nil || !reflect.DeepEqual(service.Library(), before) {
		t.Fatalf("failed automation save changed owned state: %+v, %v", service.Library(), err)
	}
	if _, err := service.Apply(store, email.ID, settings, config); err == nil || service.ActiveID() != manual.ID {
		t.Fatalf("failed profile transaction changed active selection: %v", err)
	}
	resolved, err = service.Resolve(true, "windows:outlook.exe", settings, config)
	if err != nil || resolved.ID != manual.ID {
		t.Fatalf("failed persistence consumed the pending override: %+v, %v", resolved, err)
	}
	service.ClearOverride()
	resolved, err = service.Resolve(true, "windows:outlook.exe", settings, config)
	if err != nil || resolved.ID != email.ID {
		t.Fatalf("consumed override did not restore the application rule: %+v, %v", resolved, err)
	}
	resolved, err = service.Resolve(false, "windows:outlook.exe", settings, config)
	if err != nil || resolved.ID != manual.ID || resolved.Settings != settings {
		t.Fatalf("webview recording applied an application rule: %+v, %v", resolved, err)
	}
}
