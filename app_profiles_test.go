package main

import (
	"context"
	"errors"
	"os"
	"reflect"
	"testing"

	"yap/internal/inference/speech"
	"yap/internal/storage"
)

type profileSpeech struct{ options speech.Options }

func (f *profileSpeech) Transcribe(_ context.Context, _ string, options speech.Options) (string, error) {
	f.options = options
	return "hello world", nil
}

func TestDictationProfilesApplyPersistAndReachRecording(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	p, err := a.SaveDictationProfile(storage.DictationProfile{Name: " Email ", ModelPath: a.settings.ModelPath, Language: "de", CleanText: true, AutoPromptID: "cleanup"})
	if err != nil || p.ID == "" || p.Name != "Email" {
		t.Fatal(p, err)
	}
	before := a.settings
	if err := a.ApplyDictationProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	expected := before
	expected.Language, expected.CleanText = "de", true
	if a.settings != expected || a.textConfig.AutoPromptID != "cleanup" {
		t.Fatal("profile changed unrelated preferences", a.settings, a.textConfig)
	}
	snapshot, err := a.GetSnapshot()
	if err != nil || snapshot.ActiveProfileID != p.ID || len(snapshot.DictationProfiles) != 1 {
		t.Fatal(snapshot, err)
	}
	savedSettings, _ := a.store.Settings()
	savedText, _ := a.store.TextProcessing()
	savedProfiles, _ := a.store.DictationProfiles()
	if savedSettings != a.settings || savedText.AutoPromptID != "cleanup" || savedProfiles.ActiveID != p.ID {
		t.Fatal("profile was not durable")
	}
	fake := &profileSpeech{}
	a.engine = fake
	a.textEngine = &fakeTextEngine{output: "Cleaned email."}
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if fake.options.Model != p.ModelPath || fake.options.Language != "de" || a.status.Transcript != "Cleaned email." {
		t.Fatal("profile did not reach dictation", fake.options, a.status)
	}
	// Selecting a profile without a prompt clears automatic processing only.
	p.AutoPromptID = ""
	if _, err := a.SaveDictationProfile(p); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyDictationProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	if !a.textConfig.Enabled || a.textConfig.AutoPromptID != "" {
		t.Fatal("clearing a profile prompt disabled the shared model")
	}
}

func TestDictationProfilesUnavailableResourcesPreserveConfiguration(t *testing.T) {
	for _, scenario := range []string{"missing model", "disabled text model", "deleted prompt", "invalid language"} {
		t.Run(scenario, func(t *testing.T) {
			a := testApp(t)
			enableText(t, a, false)
			p, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Email", ModelPath: a.settings.ModelPath, Language: "en", AutoPromptID: "cleanup"})
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "missing model":
				os.Remove(p.ModelPath)
			case "disabled text model":
				a.textConfig.Enabled = false
			case "deleted prompt":
				a.textConfig.Prompts = nil
			case "invalid language":
				p.Language = "bogus"
				if _, err := a.SaveDictationProfile(p); err == nil {
					t.Fatal("invalid language accepted")
				}
				return
			}
			settings, config := a.settings, a.textConfig
			if err := a.ApplyDictationProfile(p.ID); err == nil {
				t.Fatal("unavailable profile applied")
			}
			if settings != a.settings || !reflect.DeepEqual(config, a.textConfig) || a.profileLibrary.ActiveID != "" {
				t.Fatal("failed application changed configuration")
			}
		})
	}
}

func TestDictationProfilesBusyEditsAndDeletion(t *testing.T) {
	a := testApp(t)
	p, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Notes", ModelPath: a.settings.ModelPath, Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyDictationProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	for _, phase := range []string{"recording", "transcribing", "backup", "text-processing"} {
		a.status.Phase = phase
		if _, err := a.SaveDictationProfile(p); err == nil {
			t.Fatal("saved profile during", phase)
		}
		if err := a.ApplyDictationProfile(p.ID); err == nil {
			t.Fatal("applied profile during", phase)
		}
		if err := a.DeleteDictationProfile(p.ID); err == nil {
			t.Fatal("deleted profile during", phase)
		}
	}
	a.status.Phase = "idle"
	a.settings.CleanText = true
	snapshot, _ := a.GetSnapshot()
	if snapshot.ActiveProfileID != p.ID || !snapshot.ProfileModified {
		t.Fatal("modified settings lost the selected profile or its modified state")
	}
	p.Name = "Quick notes"
	if _, err := a.SaveDictationProfile(p); err != nil {
		t.Fatal(err)
	}
	if len(a.profileLibrary.Profiles) != 1 {
		t.Fatal("edit duplicated profile")
	}
	settings := a.settings
	if err := a.DeleteDictationProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	if len(a.profileLibrary.Profiles) != 0 || a.profileLibrary.ActiveID != "" || settings != a.settings {
		t.Fatal("deleting profile changed dictation settings")
	}
}

func TestDictationCompletionWarningsPreserveRecoverableText(t *testing.T) {
	for _, processing := range []bool{false, true} {
		a := testApp(t)
		if processing {
			enableText(t, a, true)
			a.textEngine = &fakeTextEngine{err: errors.New("model unavailable")}
		} else {
			a.copyText = func(string) error { return errors.New("clipboard unavailable") }
		}
		if err := a.StartRecording(); err != nil {
			t.Fatal(err)
		}
		if err := a.StopRecording(); err != nil {
			t.Fatal(err)
		}
		a.wg.Wait()
		if !a.status.CompletionWarning || a.status.Phase != "done" || a.status.Transcript == "" {
			t.Fatal("missing recoverable warning", a.status)
		}
		a.textConfig.AutoPromptID = ""
		a.copyText = func(string) error { return nil }
		if err := a.StartRecording(); err != nil {
			t.Fatal(err)
		}
		if err := a.StopRecording(); err != nil {
			t.Fatal(err)
		}
		a.wg.Wait()
		if a.status.CompletionWarning {
			t.Fatal("warning leaked into the next dictation")
		}
	}
}

func TestDefaultProfileCapturesExistingSettingsOnce(t *testing.T) {
	a := testApp(t)
	enableText(t, a, true)
	a.settings.Language, a.settings.CleanText = "de", true
	settings, config := a.settings, a.textConfig
	if err := a.ensureDefaultProfileLocked(); err != nil {
		t.Fatal(err)
	}
	snap, err := a.GetSnapshot()
	if err != nil || len(snap.DictationProfiles) != 1 || snap.DictationProfiles[0].Name != "Default" || snap.ActiveProfileID != snap.DefaultProfileID || snap.ProfileModified {
		t.Fatal(snap, err)
	}
	baseline := snap.DictationProfiles[0]
	if !baseline.Matches(settings, config) || settings != a.settings || !reflect.DeepEqual(config, a.textConfig) {
		t.Fatal("initialization changed saved settings")
	}
	a.settings.Language = "en"
	if err := a.ensureDefaultProfileLocked(); err != nil {
		t.Fatal(err)
	}
	snap, _ = a.GetSnapshot()
	if snap.ActiveProfileID != baseline.ID || !snap.ProfileModified || snap.DictationProfiles[0] != baseline {
		t.Fatal("Default baseline was overwritten")
	}
	library, err := a.store.DictationProfiles()
	if err != nil || library.DefaultID != baseline.ID || library.ActiveID != baseline.ID || library.Profiles[0] != baseline {
		t.Fatal("Default was not durable", library, err)
	}
	if err := a.ApplyDictationProfile(baseline.ID); err != nil {
		t.Fatal(err)
	}
	snap, _ = a.GetSnapshot()
	if snap.ProfileModified || a.settings.Language != "de" {
		t.Fatal("Default did not restore its baseline")
	}
}

func TestDefaultProfileFromSetupIncludingSkippedSetup(t *testing.T) {
	for _, skip := range []bool{false, true} {
		a := testApp(t)
		a.settings.SetupComplete = false
		a.settings.Language, a.settings.CleanText = "de", true
		a.microphoneTested, a.shortcutTested = true, true
		if skip {
			a.settings.ModelPath = ""
		}
		if err := a.CompleteSetup(skip); err != nil {
			t.Fatal(err)
		}
		snap, err := a.GetSnapshot()
		if err != nil || snap.ActiveProfileID != snap.DefaultProfileID || snap.DefaultProfileID == "" || snap.ProfileModified || !snap.DictationProfiles[0].Matches(a.settings, a.textConfig) {
			t.Fatal("setup did not create Default", snap, err)
		}
		if skip {
			settings := a.settings
			settings.ModelPath = "/first-model"
			if err := a.SaveSettings(settings); err != nil {
				t.Fatal(err)
			}
			snap, _ = a.GetSnapshot()
			if snap.ProfileModified || snap.DictationProfiles[0].ModelPath != settings.ModelPath {
				t.Fatal("first model was not captured after skipping setup")
			}
		}
	}
}

func TestModifiedProfileTracksOnlyProfileSettings(t *testing.T) {
	for _, field := range []string{"model", "language", "cleanup", "prompt", "microphone", "shortcut", "history"} {
		t.Run(field, func(t *testing.T) {
			a := testApp(t)
			if err := a.ensureDefaultProfileLocked(); err != nil {
				t.Fatal(err)
			}
			baseline := a.profileLibrary.Profiles[0]
			modified := true
			switch field {
			case "model":
				a.settings.ModelPath = "/other-model"
			case "language":
				a.settings.Language = "de"
			case "cleanup":
				a.settings.CleanText = true
			case "prompt":
				enableText(t, a, true)
			case "microphone":
				a.settings.MicrophoneID, modified = "usb", false
			case "shortcut":
				a.settings.Shortcut, modified = "Ctrl+Alt+P", false
			case "history":
				a.settings.SaveHistory, modified = false, false
			}
			snap, err := a.GetSnapshot()
			if err != nil || snap.ProfileModified != modified || snap.ActiveProfileID != baseline.ID || snap.DictationProfiles[0] != baseline {
				t.Fatal("incorrect modified state", snap, err)
			}
		})
	}
}

func TestDefaultCannotBeDeletedAndSelectedDeletionKeepsLiveSettings(t *testing.T) {
	a := testApp(t)
	if err := a.ensureDefaultProfileLocked(); err != nil {
		t.Fatal(err)
	}
	baseline := a.profileLibrary.Profiles[0]
	if err := a.DeleteDictationProfile(baseline.ID); err == nil {
		t.Fatal("deleted Default")
	}
	changed := baseline
	changed.Name = "Renamed default"
	if _, err := a.SaveDictationProfile(changed); err == nil {
		t.Fatal("renamed Default")
	}
	p, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Email", ModelPath: a.settings.ModelPath, Language: "de", CleanText: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyDictationProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	settings := a.settings
	if err := a.DeleteDictationProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	snap, err := a.GetSnapshot()
	if err != nil || a.settings != settings || snap.ActiveProfileID != baseline.ID || !snap.ProfileModified {
		t.Fatal("deletion changed live settings or lost the baseline", snap, err)
	}
}
