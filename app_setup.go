package main

import (
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"yap/internal/inference/speech"
	"yap/internal/vocabulary"
)

func (a *App) SaveVocabulary(entries []vocabulary.Entry) ([]vocabulary.Entry, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.saveVocabularyLocked(entries)
}

// Append against the current vocabulary, not a possibly stale webview snapshot.
func (a *App) AddVocabularyTerm(canonical string, aliases []string) ([]vocabulary.Entry, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	entries := append([]vocabulary.Entry{}, a.vocabulary...)
	entries = append(entries, vocabulary.Entry{ID: uuid.NewString(), Canonical: canonical, Aliases: aliases, Enabled: true})
	return a.saveVocabularyLocked(entries)
}

func (a *App) saveVocabularyLocked(entries []vocabulary.Entry) ([]vocabulary.Entry, error) {
	if err := a.available(); err != nil {
		return nil, err
	}
	if a.busy() {
		return nil, errors.New("finish the current operation before changing vocabulary")
	}
	normalized, err := vocabulary.Normalize(entries)
	if err != nil {
		return nil, err
	}
	if err = a.store.SaveVocabulary(normalized); err != nil {
		return nil, err
	}
	a.vocabulary = normalized
	a.diagnostic = DiagnosticResult{}
	a.event("setup:changed")
	return normalized, nil
}

// Microphone-only tests never invoke inference or retain their audio.
func (a *App) StartMicrophoneTest() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.startCaptureTest(false)
}

func (a *App) startCaptureTest(transcription bool) error {
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation first")
	}
	f, err := os.CreateTemp(filepath.Join(a.store.Dir, "recordings"), "mic-test-*.wav")
	if err != nil {
		return err
	}
	path := f.Name()
	if err = f.Close(); err != nil {
		os.Remove(path)
		return err
	}
	a.microphoneTested = false
	a.micSignal.Store(false)
	if err = a.recorder.Start(path, a.settings.MicrophoneID, func(level float64) {
		if level >= .03 && level <= 1 {
			a.micSignal.Store(true)
		}
		a.event("dictation:level", level)
	}); err != nil {
		os.Remove(path)
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
	a.emit()
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
	if err := a.available(); err != nil {
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
	if diagnostic && err == nil && a.micSignal.Load() && duration >= 300 {
		a.microphoneTested = true
		a.transcribeDiagnostic(duration)
		return nil
	}
	removeErr := os.Remove(a.path)
	if err == nil && removeErr != nil && !os.IsNotExist(removeErr) {
		err = removeErr
	}
	a.microphoneTested = err == nil && a.micSignal.Load()
	a.status.Phase, a.status.Message = "idle", "Microphone test passed"
	a.status.StartedAt = 0
	if err == nil && !a.microphoneTested {
		err = errors.New("no microphone signal detected; check microphone access and choose another input")
	}
	if diagnostic {
		if err == nil {
			err = errors.New("record for at least a moment before stopping the test")
		}
		a.diagnostic = DiagnosticResult{Phase: "error", Message: err.Error()}
	}
	if err != nil {
		a.status.Message = err.Error()
	}
	a.emit()
	a.event("setup:changed")
	return err
}

func (a *App) CompleteSetup(skip bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation first")
	}
	if !skip {
		if err := speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath}); err != nil {
			return err
		}
		if !a.microphoneTested {
			return errors.New("test your microphone before finishing setup")
		}
		if !a.shortcutTested || a.status.ShortcutError != "" {
			return errors.New("press your registered shortcut before finishing setup")
		}
	}
	settings := a.settings
	settings.SetupComplete = true
	if err := a.store.SaveSettings(settings); err != nil {
		return err
	}
	a.settings = settings
	a.event("setup:changed")
	return nil
}

func (a *App) RestartSetup() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation first")
	}
	settings := a.settings
	settings.SetupComplete = false
	if err := a.store.SaveSettings(settings); err != nil {
		return err
	}
	a.settings = settings
	a.microphoneTested, a.shortcutTested = false, false
	a.event("setup:changed")
	return nil
}
