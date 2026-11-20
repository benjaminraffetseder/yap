package preferences

import (
	"strings"
	"testing"

	"yap/internal/audio"
	"yap/internal/storage"
)

func TestSettingsValidationPreservesErrorOrderAndShortcutNormalization(t *testing.T) {
	previous := storage.Defaults()
	tests := []struct {
		name    string
		change  func(*storage.Settings)
		profile string
		want    string
	}{
		{"interaction first", func(s *storage.Settings) { s.Interaction, s.Language = "invalid", "invalid" }, "", "choose hold or toggle recording"},
		{"retention before language", func(s *storage.Settings) { s.HistoryRetentionDays, s.Language = 12, "invalid" }, "", "choose forever, 7, 30, or 90 days for History retention"},
		{"language", func(s *storage.Settings) { s.Language = "english" }, "", "use auto or a language code such as en or de"},
		{"shortcut syntax", func(s *storage.Settings) { s.Shortcut = "nonsense" }, "", "use a modifier and a key, such as Ctrl+Alt+Space"},
		{"normalized collision", func(s *storage.Settings) { s.Shortcut = "Ctrl+Alt+P" }, "Alt+Ctrl+P", "recording and profile cycling must use different shortcuts"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			next := previous
			test.change(&next)
			if _, err := Prepare(previous, next, test.profile); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("validation = %v, want %q", err, test.want)
			}
		})
	}
}

func TestMicrophoneValidationOnlyRefreshesChangedExplicitDevice(t *testing.T) {
	previous := storage.Defaults()
	previous.MicrophoneID = "previous-device"
	for _, id := range []string{"", previous.MicrophoneID, "new-device"} {
		next := previous
		next.MicrophoneID = id
		change, err := Prepare(previous, next, "")
		if err != nil {
			t.Fatal(err)
		}
		if change.NeedsMicrophoneValidation() != (id == "new-device") {
			t.Fatal("default or unchanged microphone required enumeration", id)
		}
		if id == "new-device" {
			if err := change.ValidateMicrophones([]audio.Device{{ID: "previous-device"}}); err == nil {
				t.Fatal("accepted unavailable microphone")
			}
			if err := change.ValidateMicrophones([]audio.Device{{ID: id}}); err != nil {
				t.Fatal("rejected connected microphone", err)
			}
		}
	}
}

func TestEnvironmentValidationRetainsSetupAndStartupCapabilities(t *testing.T) {
	previous := storage.Defaults()
	next := previous
	next.SetupComplete, next.StartInTray, next.LaunchAtLogin = !previous.SetupComplete, true, true
	change, err := Prepare(previous, next, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := change.ValidateEnvironment(false, false); err == nil || err.Error() != "use setup to change its completion state" {
		t.Fatal("startup validation bypassed setup completion", err)
	}
	next.SetupComplete = previous.SetupComplete
	change, _ = Prepare(previous, next, "")
	if err := change.ValidateEnvironment(false, false); err == nil || !strings.HasPrefix(err.Error(), "start in background") {
		t.Fatal("startup validation priority changed", err)
	}
	if err := change.ValidateEnvironment(true, false); err == nil || err.Error() != "launch at login is unavailable in this build" {
		t.Fatal("unavailable login registration was accepted", err)
	}
	if err := change.ValidateEnvironment(true, true); err != nil {
		t.Fatal(err)
	}
	previous.StartInTray = true
	next = previous
	change, _ = Prepare(previous, next, "")
	if err := change.ValidateEnvironment(false, false); err != nil {
		t.Fatal("existing background preference required a newly available tray", err)
	}
}

func TestChangeEffectsInvalidateOnlyCapturedDiagnosticInputs(t *testing.T) {
	previous := storage.Defaults()
	tests := []struct {
		name       string
		change     func(*storage.Settings)
		diagnostic bool
		microphone bool
		shortcut   bool
	}{
		{"microphone", func(s *storage.Settings) { s.MicrophoneID = "device" }, true, true, false},
		{"whisper", func(s *storage.Settings) { s.WhisperPath += "new" }, true, false, false},
		{"model", func(s *storage.Settings) { s.ModelPath += "new" }, true, false, false},
		{"language", func(s *storage.Settings) { s.Language = "de" }, true, false, false},
		{"clean text", func(s *storage.Settings) { s.CleanText = !s.CleanText }, true, false, false},
		{"shortcut", func(s *storage.Settings) { s.Shortcut = "Ctrl+Alt+P" }, false, false, true},
		{"retention", func(s *storage.Settings) { s.HistoryRetentionDays = 7 }, false, false, false},
		{"history", func(s *storage.Settings) { s.SaveHistory = !s.SaveHistory }, false, false, false},
		{"login", func(s *storage.Settings) { s.LaunchAtLogin = !s.LaunchAtLogin }, false, false, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			next := previous
			test.change(&next)
			change, err := Prepare(previous, next, "")
			if err != nil {
				t.Fatal(err)
			}
			if change.InvalidatesDiagnostics() != test.diagnostic || change.MicrophoneChanged() != test.microphone || change.ShortcutChanged() != test.shortcut {
				t.Fatal("change invalidated unrelated setup evidence")
			}
		})
	}
}

func TestLoginRegistrationRefreshesEnabledPathAndUsesNativeRollbackBaseline(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		for _, native := range []bool{false, true} {
			previous := storage.Defaults()
			next := previous
			next.LaunchAtLogin = enabled
			change, err := Prepare(previous, next, "")
			if err != nil {
				t.Fatal(err)
			}
			if change.UpdateLoginRegistration(true, native) != (enabled || native) || change.UpdateLoginRegistration(false, native) {
				t.Fatalf("login refresh policy changed for enabled=%v native=%v", enabled, native)
			}
		}
	}
}

func TestHistoryPreferenceRespectsPermissionResultAndBackupReservations(t *testing.T) {
	for _, test := range []struct {
		registering, result, backup bool
		want                        string
	}{
		{true, true, true, "finish shortcut registration before changing history preferences"},
		{false, true, true, "finish the result action before changing history preferences"},
		{false, false, true, "finish the backup before changing history preferences"},
		{false, false, false, ""},
	} {
		err := HistoryChangeAllowed(test.registering, test.result, test.backup)
		if test.want == "" {
			if err != nil {
				t.Fatal(err)
			}
		} else if err == nil || err.Error() != test.want {
			t.Fatalf("history preference reservation = %v, want %q", err, test.want)
		}
	}
}
