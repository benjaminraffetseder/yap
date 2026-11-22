package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

func TestTransientRuntimeDoesNotReadHistoryAndRecentReadIsBounded(t *testing.T) {
	a := testApp(t)
	for index := 0; index < 9; index++ {
		entry := storage.NewSession(fmt.Sprintf("recent-%02d", index), 1000, strings.Repeat("synthetic text ", 1000), "base", "en", "")
		entry.CreatedAt = time.Date(2026, 1, 1, 0, index, 0, 0, time.UTC).Format(time.RFC3339Nano)
		if err := a.store.Add(entry); err != nil {
			t.Fatal(err)
		}
	}
	recent, err := a.GetRecentHistory()
	if err != nil || len(recent) != 5 || recent[0].ID != "recent-08" {
		t.Fatalf("bounded recent read: %v, %v", recent, err)
	}
	legacy, err := a.GetSnapshot()
	if err != nil || len(legacy.History) != 9 {
		t.Fatalf("legacy history: %d, %v", len(legacy.History), err)
	}
	if err := a.store.Close(); err != nil {
		t.Fatal(err)
	}
	runtime, err := a.GetRuntimeSnapshot()
	if err != nil || len(runtime.History) != 0 {
		t.Fatalf("transient read touched closed database: %+v, %v", runtime, err)
	}
	encoded, err := json.Marshal(runtime)
	if err != nil || bytes.Contains(encoded, []byte("synthetic text")) {
		t.Fatal("runtime leaked historical payload", err)
	}
}

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

func seedRecentHistory(t *testing.T, a *App) {
	t.Helper()
	for i := 0; i < 8; i++ {
		entry := storage.NewSession(fmt.Sprintf("session-%d", i), 1000, "Synthetic text", "base", "en", "")
		entry.CreatedAt = time.Date(2026, 1, 1, 0, i, 0, 0, time.UTC).Format(time.RFC3339Nano)
		entry.Stats = &storage.SpeechStats{TranscriptionMS: 100, Engine: "whisper"}
		if err := a.store.Add(entry); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRecentHistoryUsesBoundedIndependentCopiesDuringBackup(t *testing.T) {
	a := testApp(t)
	seedRecentHistory(t, a)
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
	for range 2 {
		recent, err := a.GetRecentHistory()
		if err != nil || len(recent) != 5 || recent[0].ID != "session-7" || recent[4].ID != "session-3" || recent[0].Stats.Engine != "whisper" {
			t.Fatal("unexpected reserved history", recent, err)
		}
		recent[0].ID, recent[0].Stats.Engine = "modified", "modified"
	}
}

func TestRecentHistoryReadsCurrentRowsAfterHomeRelease(t *testing.T) {
	for _, mode := range []string{"first palette read", "after deletion"} {
		t.Run(mode, func(t *testing.T) {
			a := testApp(t)
			seedRecentHistory(t, a)
			wantFirst, wantLast := "session-7", "session-3"
			if mode == "after deletion" {
				recent, err := a.GetRecentHistory()
				if err != nil || len(recent) != 5 {
					t.Fatal("prime recent history", recent, err)
				}
				if err := a.DeleteSessions([]string{recent[0].ID}); err != nil {
					t.Fatal(err)
				}
				wantFirst, wantLast = "session-6", "session-2"
			}
			type reply struct {
				rows []storage.Session
				err  error
			}
			result := make(chan reply, 1)
			func() {
				if _, _, err := a.beginHomeResult(); err != nil {
					t.Fatal(err)
				}
				defer a.endHomeResult()
				go func() {
					rows, err := a.GetRecentHistory()
					result <- reply{rows, err}
				}()
				awaitHomeFlag(t, a, func() bool { return a.homeHistoryWait != nil })
			}()
			select {
			case got := <-result:
				if got.err != nil || len(got.rows) != 5 || got.rows[0].ID != wantFirst || got.rows[4].ID != wantLast {
					t.Fatal("palette read returned obsolete history", got)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("palette read did not finish after Home released SQLite")
			}
		})
	}
}

func TestLegacyHomeHistoryRetainsEditsAndOlderSessions(t *testing.T) {
	a := testApp(t)
	seedRecentHistory(t, a)
	if _, err := a.GetSnapshot(); err != nil {
		t.Fatal(err)
	}
	result := homeResult(t, a)
	if err := a.HomeResultAction(result.Session.ID, result.Revision, "edit", "Saved edit"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetRecentHistory(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.beginHomeResult(); err != nil {
		t.Fatal(err)
	}
	defer a.endHomeResult()
	if err := a.store.Close(); err != nil {
		t.Fatal(err)
	}
	snapshot, err := a.GetSnapshot()
	if err != nil || len(snapshot.History) != 8 || snapshot.History[0].FinalTranscript != "Saved edit" {
		t.Fatal("legacy cache lost the completed edit or older sessions", snapshot.History, err)
	}
}

func TestFirstLegacySnapshotDuringHomeIgnoresDeletedRecentRows(t *testing.T) {
	a := testApp(t)
	seedRecentHistory(t, a)
	recent, err := a.GetRecentHistory()
	if err != nil || len(recent) != 5 {
		t.Fatal("prime palette history", recent, err)
	}
	deletedID := recent[0].ID
	if err := a.DeleteSessions([]string{deletedID}); err != nil {
		t.Fatal(err)
	}
	type reply struct {
		snapshot Snapshot
		err      error
	}
	replies := make(chan reply, 2)
	func() {
		if _, _, err := a.beginHomeResult(); err != nil {
			t.Fatal(err)
		}
		defer a.endHomeResult()
		for range 2 {
			go func() { snapshot, err := a.GetSnapshot(); replies <- reply{snapshot, err} }()
		}
		select {
		case got := <-replies:
			t.Fatalf("first legacy reader published an incomplete or obsolete cache: %d rows, %v", len(got.snapshot.History), got.err)
		case <-time.After(20 * time.Millisecond):
		}
		// Both first-time consumers must wait outside mu, leaving controls live.
		if _, err := a.GetRuntimeSnapshot(); err != nil {
			t.Fatal(err)
		}
	}()
	for range 2 {
		select {
		case got := <-replies:
			if got.err != nil || len(got.snapshot.History) != 7 {
				t.Fatal("legacy reader lost the full current snapshot", got)
			}
			for _, entry := range got.snapshot.History {
				if entry.ID == deletedID {
					t.Fatal("deleted palette row entered the compatibility snapshot")
				}
			}
		case <-time.After(2 * time.Second):
			t.Fatal("legacy snapshot did not resume after Home released SQLite")
		}
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
