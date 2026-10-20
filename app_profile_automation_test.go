package main

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"yap/internal/storage"
)

func automationProfiles(t *testing.T, a *App) (storage.DictationProfile, storage.DictationProfile) {
	t.Helper()
	manual, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Notes", ModelPath: a.settings.ModelPath, Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	email, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Email", ModelPath: a.settings.ModelPath, Language: "de", CleanText: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyDictationProfile(manual.ID); err != nil {
		t.Fatal(err)
	}
	a.settings.AutoPaste = false // Tests never send input to another application.
	return manual, email
}

func TestAutomaticProfileCapturesConfigurationWithoutChangingManualFallback(t *testing.T) {
	a := testApp(t)
	manual, email := automationProfiles(t, a)
	enableText(t, a, false)
	email.AutoPromptID = "cleanup"
	if _, err := a.SaveDictationProfile(email); err != nil {
		t.Fatal(err)
	}
	a.activeApplication = func() string { return "windows:OUTLOOK.exe" }
	rules := []storage.AppProfileRule{{ApplicationID: "windows:outlook.exe", ApplicationName: "Outlook", ProfileID: email.ID}}
	if err := a.SaveProfileAutomation(rules, ""); err != nil {
		t.Fatal(err)
	}
	before, config := a.settings, a.textConfig
	fake := &profileSpeech{}
	a.engine = fake
	a.textEngine = &fakeTextEngine{output: "Email result"}
	a.hotkeyDown()
	if a.status.Phase != "recording" || a.status.ProfileID != email.ID || a.recordSettings.Language != "de" || !a.recordSettings.CleanText || a.recordTextConfig.AutoPromptID != "cleanup" {
		t.Fatal("rule not captured", a.status, a.recordSettings)
	}
	// Focus changes after recording starts cannot alter the captured profile.
	a.activeApplication = func() string { return "windows:slack.exe" }
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if fake.options.Language != "de" || a.status.Transcript != "Email result" {
		t.Fatal("automatic configuration did not reach inference", fake.options, a.status)
	}
	if a.settings != before || !reflect.DeepEqual(config, a.textConfig) || a.profileLibrary.ActiveID != manual.ID {
		t.Fatal("automatic rule changed manual settings")
	}
	a.hotkeyDown()
	if a.recordSettings.Language != "en" || a.status.ProfileID != manual.ID {
		t.Fatal("unassigned app inherited automatic settings")
	}
	_ = a.Cancel()
	a.activeApplication = func() string { return "windows:outlook.exe" }
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if a.status.ProfileID != manual.ID || a.recordSettings.Language != "en" {
		t.Fatal("UI recording applied an external app rule")
	}
	_ = a.Cancel()
}

func TestUnavailableAutomaticProfileDoesNotStartOrChangeSettings(t *testing.T) {
	a := testApp(t)
	_, email := automationProfiles(t, a)
	email.ModelPath += ".missing"
	if _, err := a.SaveDictationProfile(email); err != nil {
		t.Fatal(err)
	}
	if err := a.SaveProfileAutomation([]storage.AppProfileRule{{ApplicationID: "windows:outlook.exe", ApplicationName: "Outlook", ProfileID: email.ID}}, ""); err != nil {
		t.Fatal(err)
	}
	a.activeApplication = func() string { return "windows:outlook.exe" }
	before := a.settings
	a.hotkeyDown()
	if a.status.Phase != "error" || !strings.Contains(a.status.Message, "automatic profile Email") || a.path != "" || a.settings != before {
		t.Fatal("unavailable automatic profile started recording", a.status)
	}
}

func TestCycleProfilesSkipsUnavailableAndOverridesRuleForOneRecording(t *testing.T) {
	a := testApp(t)
	manual, email := automationProfiles(t, a)
	broken, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Unavailable", ModelPath: "missing", Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	a.activeApplication = func() string { return "windows:outlook.exe" }
	if err := a.SaveProfileAutomation([]storage.AppProfileRule{{ApplicationID: "windows:outlook.exe", ApplicationName: "Outlook", ProfileID: email.ID}}, ""); err != nil {
		t.Fatal(err)
	}
	if err := a.CycleDictationProfile(); err != nil {
		t.Fatal(err)
	}
	if a.profileLibrary.ActiveID != manual.ID || a.profileLibrary.ActiveID == broken.ID {
		t.Fatal("cycle did not skip unavailable profile")
	}
	a.hotkeyDown()
	if a.status.ProfileID != manual.ID {
		t.Fatal("automatic rule undid shortcut selection")
	}
	if err := a.CycleDictationProfile(); err == nil {
		t.Fatal("cycled during recording")
	}
	_ = a.Cancel()
	a.hotkeyDown()
	if a.status.ProfileID != email.ID {
		t.Fatal("one-recording override did not expire")
	}
	_ = a.Cancel()
	if err := a.CycleDictationProfile(); err != nil {
		t.Fatal(err)
	}
	a.activeApplication = func() string { return "windows:code.exe" }
	a.hotkeyDown()
	_ = a.Cancel()
	a.activeApplication = func() string { return "windows:outlook.exe" }
	a.hotkeyDown()
	if a.status.ProfileID != email.ID {
		t.Fatal("override leaked after dictating in another application")
	}
	_ = a.Cancel()
}

func TestProfileShortcutRollbackCaptureAndStaleCallbacks(t *testing.T) {
	a := testApp(t)
	manual, _ := automationProfiles(t, a)
	callbacks := map[string]func(){}
	registrations := map[string]*fakeShortcutRegistration{}
	a.registerKey = func(value string, down, _ func()) (shortcutRegistration, error) {
		if value == "Ctrl+Alt+Q" {
			return nil, errors.New("already in use")
		}
		callbacks[value] = down
		s := &fakeShortcutRegistration{}
		registrations[value] = s
		return s, nil
	}
	if err := a.SaveProfileAutomation(nil, "Ctrl+Alt+P"); err != nil {
		t.Fatal(err)
	}
	oldCallback, oldKey := callbacks["Ctrl+Alt+P"], registrations["Ctrl+Alt+P"]
	if err := a.SaveProfileAutomation(nil, "Ctrl+Alt+Q"); err == nil {
		t.Fatal("accepted occupied shortcut")
	}
	saved, _ := a.store.DictationProfiles()
	if saved.ProfileShortcut != "Ctrl+Alt+P" || a.profileLibrary.ProfileShortcut != saved.ProfileShortcut || a.profileShortcut == nil || oldKey.closed != 1 {
		t.Fatal("conflicting shortcut did not restore old state")
	}
	oldCallback()
	if a.profileLibrary.ActiveID != manual.ID {
		t.Fatal("retired registration cycled profiles")
	}
	currentKey := registrations["Ctrl+Alt+P"]
	currentCallback := callbacks["Ctrl+Alt+P"]
	token, err := a.BeginShortcutCapture()
	if err != nil || currentKey.closed != 1 || a.profileShortcut != nil {
		t.Fatal("capture retained profile shortcut", err)
	}
	currentCallback()
	if a.profileLibrary.ActiveID != manual.ID {
		t.Fatal("profile cycled during capture")
	}
	if err := a.EndShortcutCapture(token); err != nil || a.profileShortcut == nil {
		t.Fatal("capture did not restore both shortcuts", err)
	}
	for _, shortcut := range []string{"Ctrl+Alt+Space", "Alt+Ctrl+Space", "nonsense"} {
		if err := a.SaveProfileAutomation(nil, shortcut); err == nil {
			t.Fatal("accepted invalid/conflicting shortcut", shortcut)
		}
	}
	settings := a.settings
	settings.Shortcut = "Alt+Ctrl+P"
	if err := a.SaveSettings(settings); err == nil {
		t.Fatal("recording shortcut collided with profile shortcut")
	}
	lastCallback := callbacks["Ctrl+Alt+P"]
	if err := a.SaveProfileAutomation(nil, ""); err != nil || a.profileShortcut != nil {
		t.Fatal("shortcut not disabled", err)
	}
	lastCallback()
	if a.profileLibrary.ActiveID != manual.ID {
		t.Fatal("disabled shortcut callback was not retired")
	}
}

func TestProfileAutomationDeleteAndSaveFailurePreserveLibrary(t *testing.T) {
	a := testApp(t)
	_, email := automationProfiles(t, a)
	rules := []storage.AppProfileRule{{ApplicationID: "windows:outlook.exe", ApplicationName: "Outlook", ProfileID: email.ID}}
	a.registerKey = func(string, func(), func()) (shortcutRegistration, error) { return &fakeShortcutRegistration{}, nil }
	if err := a.SaveProfileAutomation(rules, "Ctrl+Alt+P"); err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteDictationProfile(email.ID); err != nil {
		t.Fatal(err)
	}
	saved, _ := a.store.DictationProfiles()
	if len(saved.AppRules) != 0 || saved.ProfileShortcut != "Ctrl+Alt+P" {
		t.Fatal("deleting profile lost shortcut or retained rules", saved)
	}
	a.store.Close()
	if err := a.SaveProfileAutomation(nil, "Ctrl+Alt+Q"); err == nil {
		t.Fatal("save succeeded with unavailable storage")
	}
	if a.profileLibrary.ProfileShortcut != "Ctrl+Alt+P" || a.profileShortcut == nil {
		t.Fatal("failed persistence changed registered shortcut")
	}
}
