package app

import (
	"errors"
	"time"
	"yap/internal/app/dictionary"
	"yap/internal/app/setup"
	"yap/internal/vocabulary"
)

func (a *App) SaveVocabulary(entries []vocabulary.Entry) ([]vocabulary.Entry, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.saveVocabularyLocked(entries)
}

// Add or merge against the current vocabulary, not a stale webview snapshot.
func (a *App) AddVocabularyTerm(canonical string, aliases []string) ([]vocabulary.Entry, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.saveVocabularyLocked(dictionary.Merge(a.vocabulary, canonical, aliases))
}

func (a *App) saveVocabularyLocked(entries []vocabulary.Entry) ([]vocabulary.Entry, error) {
	if err := a.availableLocked(); err != nil {
		return nil, err
	}
	if a.busyLocked() {
		return nil, errors.New("finish the current operation before changing vocabulary")
	}
	normalized, err := dictionary.Save(a.store, entries)
	if err != nil {
		return nil, err
	}
	a.vocabulary = normalized
	a.diagnostic = DiagnosticResult{}
	a.event("setup:changed", []string{"vocabulary"})
	return vocabulary.Normalize(normalized)
}

// Microphone-only tests never invoke inference or retain their audio.
func (a *App) StartMicrophoneTest() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.startCaptureTest(false)
}

func (a *App) startCaptureTest(transcription bool) error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation first")
	}
	capture, err := setup.PrepareCapture(a.store.CreateRecording, a.discardAudioLocked)
	if err != nil {
		return err
	}
	path := capture.Path()
	a.microphoneTested = false
	a.micSignal.Store(false)
	if err = capture.Start(a.recorder, a.settings.MicrophoneID, func(level float64) {
		if setup.IsSignal(level) {
			a.micSignal.Store(true)
		}
		a.event("dictation:level", level)
	}, func() { a.event("setup:changed") }, a.discardAudioLocked); err != nil {
		return err
	}
	a.path = path
	a.status.Phase, a.status.Message = "mic-test", "Speak to test your microphone"
	if transcription {
		a.recordSettings = a.settings
		a.recordVocabulary, _ = vocabulary.Normalize(a.vocabulary)
		a.status.Phase, a.status.Message = "diagnostic-recording", "Say a short sentence, then stop the test"
		a.diagnostic = DiagnosticResult{Phase: "recording", Message: a.status.Message}
	}
	a.status.StartedAt = time.Now().UnixMilli()
	a.emitStatusLocked()
	a.event("setup:changed")
	a.timer = time.AfterFunc(10*time.Second, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if !a.closing && a.path == path && (a.status.Phase == "mic-test" || a.status.Phase == "diagnostic-recording") {
			_ = a.stopCaptureTest()
		}
	})
	return nil
}

func (a *App) StopMicrophoneTest() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.status.Phase != "mic-test" {
		return errors.New("no microphone test in progress")
	}
	return a.stopCaptureTest()
}

func (a *App) stopCaptureTest() error {
	diagnostic := a.status.Phase == "diagnostic-recording"
	if a.timer != nil {
		a.timer.Stop()
	}
	duration, err := a.recorder.Stop()
	if setup.ShouldTranscribe(diagnostic, duration, a.micSignal.Load(), err) {
		a.microphoneTested = true
		a.transcribeDiagnostic(duration)
		return nil
	}
	err = errors.Join(err, a.discardAudioLocked(a.path))
	outcome := setup.CompleteCapture(diagnostic, a.micSignal.Load(), err)
	a.microphoneTested = outcome.Passed
	a.status.Phase, a.status.Message, a.status.StartedAt = "idle", outcome.Message, 0
	if diagnostic {
		a.diagnostic = outcome.Diagnostic
	}
	err = outcome.Err
	a.emitStatusLocked()
	a.event("setup:changed")
	return err
}

func (a *App) CompleteSetup(skip bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation first")
	}
	if err := setup.ValidateComplete(skip, a.settings, a.microphoneTested, a.shortcutTested, a.status.ShortcutError); err != nil {
		return err
	}
	settings := a.settings
	settings.SetupComplete = true
	if err := a.saveSettingsWithDefaultLocked(settings); err != nil {
		return err
	}
	a.settings = settings
	a.event("setup:changed")
	return nil
}

func (a *App) RestartSetup() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation first")
	}
	settings := a.settings
	settings.SetupComplete = false
	if err := a.store.SaveSettings(settings); err != nil {
		return err
	}
	a.settings = settings
	a.microphoneTested, a.shortcutTested = false, false
	a.diagnostic = DiagnosticResult{}
	a.event("setup:changed")
	return nil
}
