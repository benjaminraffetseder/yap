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
