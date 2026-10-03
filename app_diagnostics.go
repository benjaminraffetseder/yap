package main

import (
	"context"
	"errors"
	"time"

	"yap/internal/inference/speech"
	"yap/internal/vocabulary"
)

type DiagnosticResult struct {
	Phase      string `json:"phase"`
	Message    string `json:"message"`
	Details    string `json:"details"`
	Transcript string `json:"transcript"`
	DurationMS int64  `json:"durationMs"`
}

type DiagnosticCheck struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Ready   bool   `json:"ready"`
	Message string `json:"message"`
}

// These are file/device checks. Only a completed transcription verifies that
// the selected runtime can load and use the model.
func (a *App) GetDiagnosticChecks() ([]DiagnosticCheck, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return nil, err
	}
	return a.diagnosticChecks(), nil
}

func (a *App) diagnosticChecks() []DiagnosticCheck {
	checks := []DiagnosticCheck{{ID: "runtime", Name: "Whisper runtime", Ready: true, Message: "Executable found"}, {ID: "model", Name: "Speech model", Ready: true, Message: "Model file readable"}, {ID: "microphone", Name: "Microphone", Ready: true, Message: "System default"}}
	if err := speech.ValidateExecutable(a.settings.WhisperPath); err != nil {
		checks[0].Ready, checks[0].Message = false, err.Error()
	}
	if err := speech.ValidateModel(a.settings.ModelPath); err != nil {
		checks[1].Ready, checks[1].Message = false, err.Error()
	}
	devices, err := a.microphones()
	if err != nil {
		checks[2].Ready, checks[2].Message = false, "Could not list microphones: "+err.Error()
		return checks
	}
	if len(devices) == 0 {
		checks[2].Ready, checks[2].Message = false, "Connect a microphone, then refresh."
		return checks
	}
	if a.settings.MicrophoneID != "" {
		checks[2].Ready, checks[2].Message = false, "Selected microphone is disconnected; reconnect it or choose another input in Settings."
		for _, device := range devices {
			if device.ID == a.settings.MicrophoneID {
				checks[2].Ready, checks[2].Message = true, device.Name
				break
			}
		}
	}
	return checks
}

func (a *App) StartDiagnosticTest() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
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
		a.diagnostic = DiagnosticResult{Phase: "error", Message: "Could not start microphone capture. Check microphone access, reconnect the input, or choose another microphone in Settings.", Details: err.Error()}
		a.event("setup:changed")
		return errors.New(a.diagnostic.Message)
	}
	return nil
}

func (a *App) StopDiagnosticTest() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
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
	a.emit()
	a.event("setup:changed")
	ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
	a.cancel = cancel
	path, settings, entries := a.path, a.recordSettings, a.recordVocabulary
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		defer cancel()
		text, err := a.engine.Transcribe(ctx, path, speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath, Language: settings.Language, Prompt: vocabulary.Prompt(entries)})
		// Complete cleanup before emitting the result or releasing busy state.
		a.mu.Lock()
		defer a.mu.Unlock()
		removeErr := a.discardAudioLocked(path)
		a.cancel = nil
		if a.closing {
			return
		}
		result := DiagnosticResult{Phase: "done", Message: "Runtime and model verified", Transcript: processTranscript(text, settings, entries), DurationMS: duration}
		switch {
		case errors.Is(ctx.Err(), context.Canceled):
			result = DiagnosticResult{Phase: "cancelled", Message: "Test cancelled"}
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			result = DiagnosticResult{Phase: "error", Message: "Test timed out. Try a smaller model in Models or check the selected runtime."}
		case errors.Is(err, speech.ErrNoSpeech):
			result = DiagnosticResult{Phase: "error", Message: "No speech detected. Speak a longer sentence and check the selected microphone."}
		case err != nil:
			result = DiagnosticResult{Phase: "error", Message: "Transcription failed. Check the selected whisper-cli executable and reinstall the model in Models. For a custom runtime, keep its required libraries alongside the executable.", Details: err.Error()}
		case text == "":
			result = DiagnosticResult{Phase: "error", Message: "No speech detected. Speak a longer sentence and check the selected microphone."}
		}
		if removeErr != nil {
			result.Phase, result.Message = "error", "Could not delete test audio. Check access to the app's recordings folder."
			result.Details = removeErr.Error()
			result.Transcript = ""
		}
		a.diagnostic = result
		a.status.Phase, a.status.Message = "idle", result.Message
		a.emit()
		a.event("setup:changed")
	}()
}
