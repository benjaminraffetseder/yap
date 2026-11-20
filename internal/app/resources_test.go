package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

func TestSavedResourcesMatchCompatibilitySnapshotAndDoNotShareMemory(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	a.vocabulary = []vocabulary.Entry{{ID: "term", Canonical: "Yap", Aliases: []string{"yapp"}, Enabled: true}}
	p, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Work", ModelPath: a.settings.ModelPath, Language: "de", CleanText: true, AutoPromptID: "cleanup"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyDictationProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	config, err := a.GetConfiguration()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := a.GetModelCatalog()
	if err != nil {
		t.Fatal(err)
	}
	entries, err := a.GetVocabulary()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := a.GetSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if config.Settings != snapshot.Settings || !reflect.DeepEqual(config.TextProcessing, snapshot.TextProcessing) || !reflect.DeepEqual(config.DictationProfiles, snapshot.DictationProfiles) || config.ActiveProfileID != p.ID || config.ProfileModified || !config.Ready {
		t.Fatalf("incoherent configuration: %+v", config)
	}
	if !reflect.DeepEqual(catalog.Models, snapshot.Models) || !reflect.DeepEqual(catalog.TextModels, snapshot.TextModels) || !reflect.DeepEqual(entries, snapshot.Vocabulary) {
		t.Fatal("focused read differs from compatibility snapshot")
	}
	config.DictationProfiles[0].Name = "mutated"
	config.TextProcessing.Prompts[0].Instruction = "mutated"
	entries[0].Aliases[0] = "mutated"
	again, _ := a.GetConfiguration()
	vocabularyAgain, _ := a.GetVocabulary()
	if again.DictationProfiles[0].Name == "mutated" || again.TextProcessing.Prompts[0].Instruction == "mutated" || vocabularyAgain[0].Aliases[0] == "mutated" {
		t.Fatal("caller changed native saved memory")
	}
}

func TestSavedReadsRemainAvailableWhileBackupOwnsDatabase(t *testing.T) {
	a := testApp(t)
	a.vocabulary = []vocabulary.Entry{{ID: "a", Canonical: "Term", Aliases: nil}, {ID: "b", Canonical: "term", Aliases: []string{"alias"}}}
	a.mu.Lock()
	previous, _, err := a.beginBackupLocked("Restoring backup")
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { a.mu.Lock(); a.finishBackupLocked(previous); a.mu.Unlock(); a.wg.Done() }()
	if err := a.store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetConfiguration(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetModelCatalog(); err != nil {
		t.Fatal(err)
	}
	entries, err := a.GetVocabulary()
	if err != nil || len(entries) != 2 || entries[0].Aliases == nil {
		t.Fatal("legacy conflicts must remain editable", entries, err)
	}
	if snapshot, err := a.GetRuntimeSnapshot(); err != nil || snapshot.Status.Phase != "backup" {
		t.Fatal(snapshot, err)
	}
}

func TestConfigurationReadsNeverSplitProfileApplication(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	profiles := []storage.DictationProfile{
		{Name: "German", ModelPath: a.settings.ModelPath, Language: "de", CleanText: true, AutoPromptID: "cleanup"},
		{Name: "English", ModelPath: a.settings.ModelPath, Language: "en", AutoPromptID: ""},
	}
	for i, profile := range profiles {
		saved, err := a.SaveDictationProfile(profile)
		if err != nil {
			t.Fatal(err)
		}
		profiles[i] = saved
	}
	if err := a.ApplyDictationProfile(profiles[0].ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		for i := 0; i < 30; i++ {
			if err := a.ApplyDictationProfile(profiles[i%2].ID); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	for i := 0; i < 60; i++ {
		value, err := a.GetConfiguration()
		if err != nil {
			t.Error(err)
			break
		}
		for _, profile := range profiles {
			if value.ActiveProfileID == profile.ID && (value.Settings.Language != profile.Language || value.Settings.CleanText != profile.CleanText || value.TextProcessing.AutoPromptID != profile.AutoPromptID || value.ProfileModified) {
				t.Errorf("split application: %+v", value)
			}
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestSettingsAndTrayHistoryPublishConfigurationChanges(t *testing.T) {
	a := testApp(t)
	var domains [][]string
	a.notify = func(topic string, args ...interface{}) {
		if topic == "setup:changed" && len(args) == 1 {
			if value, ok := args[0].([]string); ok {
				domains = append(domains, value)
			}
		}
	}
	settings := a.settings
	settings.Language = "de"
	if err := a.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	a.toggleHistory()
	config, err := a.GetConfiguration()
	if err != nil || config.Settings.Language != "de" || config.Settings.SaveHistory == settings.SaveHistory {
		t.Fatal(config, err)
	}
	if !reflect.DeepEqual(domains, [][]string{{"configuration"}, {"configuration"}}) {
		t.Fatal("status alone cannot invalidate saved data", domains)
	}
}

func TestModelRemovalPublishesCatalogChange(t *testing.T) {
	a := testApp(t)
	path := filepath.Join(a.store.Dir, "models", "ggml-tiny.bin")
	if err := os.WriteFile(path, []byte("model"), 0600); err != nil {
		t.Fatal(err)
	}
	a.settings.ModelPath = "custom-model"
	before, err := a.GetModelCatalog()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, model := range before.Models {
		if model.ID == "tiny" {
			found = model.Removable
		}
	}
	if !found {
		t.Fatal("fixture must contain a removable model")
	}
	var domains []string
	a.notify = func(topic string, args ...interface{}) {
		if topic == "setup:changed" && len(args) == 1 {
			domains, _ = args[0].([]string)
		}
	}
	if err := a.RemoveModel("tiny"); err != nil {
		t.Fatal(err)
	}
	after, err := a.GetModelCatalog()
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range after.Models {
		if model.ID == "tiny" && model.Removable {
			t.Fatal("catalog retained removed model metadata")
		}
	}
	if !reflect.DeepEqual(domains, []string{"catalogs"}) {
		t.Fatal("missing catalog invalidation", domains)
	}
}
