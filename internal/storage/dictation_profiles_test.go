package storage

import (
	"reflect"
	"strings"
	"testing"

	"yap/internal/inference/text"
)

func TestProfileLibraryValidationAndReopen(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	library := ProfileLibrary{ActiveID: "one", Profiles: []DictationProfile{{ID: "one", Name: "Notes", ModelPath: "/model", Language: "en"}}}
	if err := s.SaveDictationProfiles(library); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err := s.DictationProfiles()
	if err != nil || !reflect.DeepEqual(got, library) {
		t.Fatal(got, err)
	}
	for _, name := range []string{"", strings.Repeat("a", 61), "bad\nname", "\x00"} {
		bad := library
		bad.Profiles = append([]DictationProfile{}, library.Profiles...)
		bad.Profiles[0].Name = name
		if err := s.SaveDictationProfiles(bad); err == nil {
			t.Fatal("accepted invalid name", name)
		}
	}
	duplicate := library
	duplicate.Profiles = append(append([]DictationProfile{}, library.Profiles...), DictationProfile{ID: "two", Name: "NOTES", ModelPath: "/model", Language: "en"})
	if err := s.SaveDictationProfiles(duplicate); err == nil {
		t.Fatal("accepted duplicate profile names")
	}
}

func TestProfileApplicationRollsBackAllConfiguration(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	settings, config := Defaults(), text.Defaults()
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	// Fail after the settings write, exercising the transaction rollback.
	if _, err := s.db.Exec(`CREATE TRIGGER reject_profile_config BEFORE UPDATE ON text_processing BEGIN SELECT RAISE(FAIL, 'test failure'); END;`); err != nil {
		t.Fatal(err)
	}
	library := ProfileLibrary{ActiveID: "one", Profiles: []DictationProfile{{ID: "one", Name: "Notes", ModelPath: "/model", Language: "de"}}}
	changed := settings
	changed.Language = "de"
	if err := s.ApplyDictationProfile(library, changed, config); err == nil {
		t.Fatal("expected failure")
	}
	gotSettings, _ := s.Settings()
	gotLibrary, _ := s.DictationProfiles()
	if gotSettings != settings || len(gotLibrary.Profiles) != 0 || gotLibrary.ActiveID != "" {
		t.Fatal("partial profile application persisted", gotSettings, gotLibrary)
	}
}

func TestProfileTextModelNormalizesAndDetachesConnections(t *testing.T) {
	connection := &ProfileTextModel{Provider: "external", ContextLength: 4096, Enabled: true, Endpoint: "http://localhost:11434/v1", Model: " local-model "}
	library := ProfileLibrary{ActiveID: "one", Profiles: []DictationProfile{{ID: "one", Name: "Notes", ModelPath: "/model", Language: "en", TextModel: connection}}}
	normalized, err := NormalizeProfiles(library)
	if err != nil {
		t.Fatal(err)
	}
	got := normalized.Profiles[0].TextModel
	if got == connection || got.Endpoint != "http://127.0.0.1:11434/v1" || got.Model != "local-model" || got.ContextLength != 4096 || !got.Enabled {
		t.Fatalf("connection was not normalized into owned storage: %+v", got)
	}
	got.Model = "changed-through-normalized-copy"
	if connection.Model != " local-model " {
		t.Fatal("normalization shared the caller's connection pointer")
	}
	again, err := NormalizeProfiles(normalized)
	if err != nil {
		t.Fatal(err)
	}
	again.Profiles[0].TextModel.Model = "changed-again"
	if got.Model != "changed-through-normalized-copy" {
		t.Fatal("repeated normalization retained a connection alias")
	}

	unconfigured := library
	unconfigured.Profiles = []DictationProfile{{ID: "one", Name: "Notes", ModelPath: "/model", Language: "en", TextModel: &ProfileTextModel{}}}
	unconfigured, err = NormalizeProfiles(unconfigured)
	if err != nil || unconfigured.Profiles[0].TextModel.Endpoint != text.Defaults().Endpoint || unconfigured.Profiles[0].TextModel.Enabled {
		t.Fatalf("disabled unconfigured default was not accepted: %+v, %v", unconfigured, err)
	}
	invalid := library
	invalid.Profiles = []DictationProfile{{ID: "one", Name: "Notes", ModelPath: "/model", Language: "en", TextModel: &ProfileTextModel{Endpoint: "https://example.com/v1"}}}
	if _, err := NormalizeProfiles(invalid); err == nil {
		t.Fatal("accepted a remote profile text endpoint")
	}
}

func TestCapturedDefaultTracksConnectionWhileLegacyProfileInherits(t *testing.T) {
	settings, config := Defaults(), text.Defaults()
	settings.SetupComplete, settings.ModelPath = true, "/current-model"
	config.Enabled, config.Model = true, "first-model"
	library, changed, err := WithDefaultProfile(ProfileLibrary{}, settings, config)
	if err != nil || !changed || len(library.Profiles) != 1 {
		t.Fatal(library, changed, err)
	}
	captured := library.Profiles[0]
	if captured.TextModel == nil || !captured.Matches(settings, config) {
		t.Fatalf("Default did not capture its text connection: %+v", captured)
	}
	changedConfig := config
	changedConfig.Model = "second-model"
	if captured.Matches(settings, changedConfig) {
		t.Fatal("captured profile ignored a modified text connection")
	}
	legacy := captured
	legacy.TextModel = nil
	if !legacy.Matches(settings, changedConfig) {
		t.Fatal("legacy profile stopped inheriting the global text connection")
	}
}

func TestDefaultUpgradePreservesLegacyProfilesAtCapacity(t *testing.T) {
	settings, config := Defaults(), text.Defaults()
	settings.SetupComplete, settings.ModelPath = true, "/current-model"
	library := ProfileLibrary{Profiles: []DictationProfile{}}
	for i := 0; i < 20; i++ {
		id := strings.Repeat("p", i+1)
		library.Profiles = append(library.Profiles, DictationProfile{ID: id, Name: id, ModelPath: "/model", Language: "en"})
	}
	before := append([]DictationProfile{}, library.Profiles...)
	upgraded, changed, err := WithDefaultProfile(library, settings, config)
	if err != nil || !changed || len(upgraded.Profiles) != 21 || !reflect.DeepEqual(upgraded.Profiles[1:], before) || upgraded.ActiveID != upgraded.DefaultID {
		t.Fatal(upgraded, changed, err)
	}
	again, changed, err := WithDefaultProfile(upgraded, settings, config)
	if err != nil || changed || !reflect.DeepEqual(upgraded, again) {
		t.Fatal("upgrade was not idempotent", again, changed, err)
	}
	library.Profiles[0].Name = "Default"
	upgraded, _, err = WithDefaultProfile(library, settings, config)
	if err != nil || len(upgraded.Profiles) != 20 || upgraded.DefaultID != library.Profiles[0].ID || upgraded.Profiles[0].ModelPath != "/model" {
		t.Fatal("legacy Default was overwritten", upgraded, err)
	}
}
