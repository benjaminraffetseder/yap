// Package preferences validates settings changes and determines their required
// effects. Native registration, persistence and publication remain with callers.
package preferences

import (
	"errors"
	"regexp"

	"yap/internal/audio"
	"yap/internal/platform"
	"yap/internal/storage"
)

var languageCode = regexp.MustCompile(`^(auto|[a-z]{2,3})$`)

// Change keeps the committed and candidate preferences separate while native
// permission requests or launch-at-login updates are in progress.
type Change struct {
	previous storage.Settings
	next     storage.Settings
}

func Prepare(previous, next storage.Settings, profileShortcut string) (Change, error) {
	change := Change{previous: previous, next: next}
	if next.Interaction != "hold" && next.Interaction != "toggle" {
		return Change{}, errors.New("choose hold or toggle recording")
	}
	if !storage.ValidRetention(next.HistoryRetentionDays) {
		return Change{}, errors.New("choose forever, 7, 30, or 90 days for History retention")
	}
	if !languageCode.MatchString(next.Language) {
		return Change{}, errors.New("use auto or a language code such as en or de")
	}
	if _, _, err := platform.ParseShortcut(next.Shortcut); err != nil {
		return Change{}, err
	}
	if platform.SameShortcut(next.Shortcut, profileShortcut) {
		return Change{}, errors.New("recording and profile cycling must use different shortcuts")
	}
	return change, nil
}

func (c Change) MicrophoneChanged() bool { return c.previous.MicrophoneID != c.next.MicrophoneID }
func (c Change) ShortcutChanged() bool   { return c.previous.Shortcut != c.next.Shortcut }

func (c Change) NeedsMicrophoneValidation() bool {
	return c.next.MicrophoneID != "" && c.MicrophoneChanged()
}

func (c Change) ValidateMicrophones(devices []audio.Device) error {
	for _, device := range devices {
		if device.ID == c.next.MicrophoneID {
			return nil
		}
	}
	return errors.New("selected microphone is unavailable; refresh microphones in Settings and choose a connected device")
}

func (c Change) ValidateEnvironment(startInTrayAvailable, launchAtLoginAvailable bool) error {
	if c.next.SetupComplete != c.previous.SetupComplete {
		return errors.New("use setup to change its completion state")
	}
	if c.next.StartInTray && !c.previous.StartInTray && !startInTrayAvailable {
		return errors.New("start in background requires tray or menu-bar controls in a packaged app")
	}
	if !launchAtLoginAvailable && c.next.LaunchAtLogin != c.previous.LaunchAtLogin {
		return errors.New("launch at login is unavailable in this build")
	}
	return nil
}

// Re-enabling refreshes the executable path after moving or updating the app.
func (c Change) UpdateLoginRegistration(available, previousLogin bool) bool {
	return available && (c.next.LaunchAtLogin || previousLogin != c.next.LaunchAtLogin)
}

func (c Change) InvalidatesDiagnostics() bool {
	return c.MicrophoneChanged() || c.previous.WhisperPath != c.next.WhisperPath ||
		c.previous.ModelPath != c.next.ModelPath || c.previous.Language != c.next.Language ||
		c.previous.CleanText != c.next.CleanText
}

func HistoryChangeAllowed(registering, resultAction, backup bool) error {
	if registering {
		return errors.New("finish shortcut registration before changing history preferences")
	}
	if resultAction {
		return errors.New("finish the result action before changing history preferences")
	}
	if backup {
		return errors.New("finish the backup before changing history preferences")
	}
	return nil
}
