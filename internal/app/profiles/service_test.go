package profiles_test

import (
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
	if service.ProfileName(service.ActiveID()) != "Default" || reloaded.ProfileName(reloaded.ActiveID()) != "Default" {
		t.Fatal("snapshot mutation changed owned profile state")
	}

	// A failed first-run save must not publish a baseline without its settings.
	var failed profiles.Service
	store.Close()
	if err := failed.SaveSettings(store, settings, config); err == nil || failed.ActiveID() != "" || len(failed.Library().Profiles) != 0 {
		t.Fatalf("failed save published a default: %+v, %v", failed.Library(), err)
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
