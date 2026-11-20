package app

import (
	"context"
	"errors"
	"time"

	"yap/internal/app/setup"
)

type DiagnosticResult = setup.DiagnosticResult
type DiagnosticCheck = setup.DiagnosticCheck

// These are file/device checks. Only a completed transcription verifies that
// the selected runtime can load and use the model.
func (a *App) GetDiagnosticChecks() ([]DiagnosticCheck, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return nil, err
	}
	return a.diagnosticChecks(), nil
}

func (a *App) diagnosticChecks() []DiagnosticCheck {
	return setup.Checks(a.settings, a.microphones)
}

func (a *App) StartDiagnosticTest() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation first")
	}
	for _, check := range a.diagnosticChecks() {
		if !check.Ready {
			a.diagnostic = DiagnosticResult{Phase: "error", Message: check.Message}
			a.event("setup:changed")
			return errors.New(check.Message)
		}
	}
	if err := a.startCaptureTest(true); err != nil {
		a.diagnostic = setup.CaptureFailure(err)
		a.event("setup:changed")
		return errors.New(a.diagnostic.Message)
	}
	return nil
}

func (a *App) StopDiagnosticTest() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.status.Phase != "diagnostic-recording" {
		return errors.New("no dictation test in progress")
	}
	return a.stopCaptureTest()
}

func (a *App) transcribeDiagnostic(duration int64) {
	a.status.Phase, a.status.Message = "diagnostic-transcribing", "Transcribing the test on your device…"
	a.status.StartedAt = 0
	a.diagnostic = DiagnosticResult{Phase: "transcribing", Message: a.status.Message, DurationMS: duration}
	a.emitStatusLocked()
	a.event("setup:changed")
	ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
	a.cancel = cancel
	path, settings, entries := a.path, a.recordSettings, a.recordVocabulary
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		defer cancel()
		text, err := setup.Transcribe(ctx, a.engine, path, settings, entries)
		// Complete cleanup before emitting the result or releasing busy state.
		a.mu.Lock()
		defer a.mu.Unlock()
		removeErr := a.discardAudioLocked(path)
		a.cancel = nil
		if a.closing {
			return
		}
		result := setup.CompleteDiagnostic(ctx.Err(), text, err, removeErr, settings, entries, duration)
		a.diagnostic = result
		a.status.Phase, a.status.Message = "idle", result.Message
		a.emitStatusLocked()
		a.event("setup:changed")
	}()
}
