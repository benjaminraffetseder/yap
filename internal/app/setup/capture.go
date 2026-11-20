// Package setup owns onboarding validation, microphone checks and diagnostics.
// The caller coordinates the shared microphone, timers and operation lifetime.
package setup

import (
	"errors"
	"os"

	"yap/internal/audio"
	"yap/internal/inference/speech"
	"yap/internal/storage"
)

type Capture struct{ path string }

func PrepareCapture(create func() (*os.File, string, error), discard func(string) error) (Capture, error) {
	file, path, err := create()
	if err != nil {
		return Capture{}, err
	}
	if err := file.Close(); err != nil {
		return Capture{}, errors.Join(err, discard(path))
	}
	return Capture{path: path}, nil
}

func (capture Capture) Path() string { return capture.path }

func (capture Capture) Start(recorder audio.Capture, microphoneID string, level func(float64), failed func(), discard func(string) error) error {
	if err := recorder.Start(capture.path, microphoneID, level); err != nil {
		failed()
		return errors.Join(err, discard(capture.path))
	}
	return nil
}

func IsSignal(level float64) bool { return level >= .03 && level <= 1 }

func ShouldTranscribe(diagnostic bool, duration int64, signal bool, err error) bool {
	return diagnostic && err == nil && signal && duration >= 300
}

type CaptureOutcome struct {
	Passed     bool
	Message    string
	Diagnostic DiagnosticResult
	Err        error
}

func CompleteCapture(diagnostic, signal bool, err error) CaptureOutcome {
	outcome := CaptureOutcome{Passed: err == nil && signal, Message: "Microphone test passed", Err: err}
	if err == nil && !outcome.Passed {
		outcome.Err = errors.New("no microphone signal detected; check microphone access and choose another input")
	}
	if diagnostic {
		if outcome.Err == nil {
			outcome.Err = errors.New("record for at least a moment before stopping the test")
		}
		outcome.Diagnostic = DiagnosticResult{Phase: "error", Message: outcome.Err.Error()}
	}
	if outcome.Err != nil {
		outcome.Message = outcome.Err.Error()
	}
	return outcome
}

func ValidateComplete(skip bool, settings storage.Settings, microphoneTested, shortcutTested bool, shortcutError string) error {
	if skip {
		return nil
	}
	if err := speech.Validate(speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath}); err != nil {
		return err
	}
	if !microphoneTested {
		return errors.New("test your microphone before finishing setup")
	}
	if !shortcutTested || shortcutError != "" {
		return errors.New("press your registered shortcut before finishing setup")
	}
	return nil
}
