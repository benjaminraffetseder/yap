package app

import (
	"yap/internal/inference/speech"
	"yap/internal/tray"
)

func (a *App) trayRecord() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing {
		return
	}
	if a.status.Phase == "recording" {
		a.stopRecordingLocked()
	} else if !a.busyLocked() {
		// Clicking native menus changes focus. Copy only instead of guessing
		// which application should receive an automatic paste.
		if err := a.startRecordingLocked(false); err != nil {
			a.failLocked(err)
		}
	}
}

func (a *App) updateTrayLocked() {
	if a.tray != nil {
		ready := a.store != nil && speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath}) == nil
		phase := a.status.Phase
		if phase == "transcribing" && a.status.Message == "Processing text…" {
			phase = "text-processing"
		}
		if a.shortcuts.Capturing() {
			phase = "shortcut-capture"
		}
		resultAvailable := !a.homeResultHidden && (a.homeResult != nil || a.latestResult != nil || len(a.homeHistory) > 0)
		a.tray.Update(tray.State{
			Phase: phase, Completion: a.status.Message, Warning: a.status.CompletionWarning,
			Ready: ready, Busy: a.busyLocked(), SaveHistory: a.settings.SaveHistory, HistoryLocked: a.homeResultOperation,
			ResultAvailable: resultAvailable, ShortcutUnavailable: a.status.ShortcutError != "" || a.status.ProfileShortcutError != "",
		})
	}
}
