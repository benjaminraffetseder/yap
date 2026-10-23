package storage

import (
	"reflect"
	"testing"
)

func TestApplicationRulesNormalizePersistAndRejectAmbiguity(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	library := ProfileLibrary{ActiveID: "email", ProfileShortcut: "Ctrl+Alt+P", Profiles: []DictationProfile{{ID: "email", Name: "Email", ModelPath: "/model", Language: "en"}}, AppRules: []AppProfileRule{{ApplicationID: " windows:OUTLOOK.exe ", ApplicationName: " Outlook ", ProfileID: "email"}}}
	normalized, err := NormalizeProfiles(library)
	if err != nil || normalized.AppRules[0].ApplicationID != "windows:outlook.exe" || normalized.AppRules[0].ApplicationName != "Outlook" {
		t.Fatal(normalized, err)
	}
	if library.AppRules[0].ApplicationName != " Outlook " {
		t.Fatal("normalization mutated caller's rules")
	}
	legacy := library
	legacy.AppRules = []AppProfileRule{{ApplicationID: "windows:code.exe", ApplicationName: "Code.EXE", ProfileID: "email"}, {ApplicationID: "macos:com.example.exe", ApplicationName: "Tool.exe", ProfileID: "email"}}
	if got, err := NormalizeProfiles(legacy); err != nil || got.AppRules[0].ApplicationName != "Code" || got.AppRules[0].ApplicationID != "windows:code.exe" || got.AppRules[1].ApplicationName != "Tool.exe" {
		t.Fatal("Windows rule names keep the executable extension", got, err)
	}
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
	if err != nil || !reflect.DeepEqual(normalized, got) {
		t.Fatal("rules did not survive restart", got, err)
	}
	for _, rules := range [][]AppProfileRule{
		{{ApplicationID: "windows:app.exe", ApplicationName: "App", ProfileID: "missing"}},
		{{ApplicationID: "windows:app.exe", ApplicationName: "App", ProfileID: "email"}, {ApplicationID: "WINDOWS:APP.EXE", ApplicationName: "App", ProfileID: "email"}},
		{{ApplicationID: "", ApplicationName: "App", ProfileID: "email"}},
	} {
		bad := normalized
		bad.AppRules = rules
		if err := s.SaveDictationProfiles(bad); err == nil {
			t.Fatal("invalid rule accepted", rules)
		}
	}
}
