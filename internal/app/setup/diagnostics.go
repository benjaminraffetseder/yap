package setup

import (
	"context"
	"errors"

	"yap/internal/app/recording"
	"yap/internal/audio"
	"yap/internal/inference/speech"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

type DiagnosticResult struct {
	Phase         string `json:"phase"`
	Message       string `json:"message"`
	Details       string `json:"details"`
	Transcript    string `json:"transcript"`
	RawTranscript string `json:"rawTranscript"`
	DurationMS    int64  `json:"durationMs"`
}

type DiagnosticCheck struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Ready   bool   `json:"ready"`
	Message string `json:"message"`
}

func DiagnosticMatches(result DiagnosticResult, current, tested storage.Settings) bool {
	return result.Phase == "done" && current.MicrophoneID == tested.MicrophoneID &&
		current.WhisperPath == tested.WhisperPath && current.ModelPath == tested.ModelPath &&
		current.Language == tested.Language && current.CleanText == tested.CleanText
}

func Checks(settings storage.Settings, microphones func() ([]audio.Device, error)) []DiagnosticCheck {
	checks := []DiagnosticCheck{{ID: "runtime", Name: "Speech runtime", Ready: true, Message: "Executable found"}, {ID: "model", Name: "Speech model", Ready: true, Message: "Model file readable"}, {ID: "microphone", Name: "Microphone", Ready: true, Message: "System default"}}
	if err := speech.ValidateRuntimeFor(speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath}); err != nil {
		checks[0].Ready, checks[0].Message = false, err.Error()
	}
	if err := speech.ValidateModel(settings.ModelPath); err != nil {
		checks[1].Ready, checks[1].Message = false, err.Error()
	}
	devices, err := microphones()
	if err != nil {
		checks[2].Ready, checks[2].Message = false, "Could not list microphones: "+err.Error()
		return checks
	}
	if len(devices) == 0 {
		checks[2].Ready, checks[2].Message = false, "Connect a microphone, then refresh."
		return checks
	}
	if settings.MicrophoneID != "" {
		checks[2].Ready, checks[2].Message = false, "Selected microphone is disconnected; reconnect it or choose another input in Settings."
		for _, device := range devices {
			if device.ID == settings.MicrophoneID {
				checks[2].Ready, checks[2].Message = true, device.Name
				break
			}
		}
	}
	return checks
}

func CompleteDiagnostic(ctxErr error, text string, err, removeErr error, settings storage.Settings, entries []vocabulary.Entry, duration int64) DiagnosticResult {
	result := DiagnosticResult{Phase: "done", Message: "Runtime and model verified", RawTranscript: text, Transcript: recording.ProcessTranscript(text, settings, entries), DurationMS: duration}
	switch {
	case errors.Is(ctxErr, context.Canceled):
		result = DiagnosticResult{Phase: "cancelled", Message: "Test cancelled"}
	case errors.Is(ctxErr, context.DeadlineExceeded):
		result = DiagnosticResult{Phase: "error", Message: "Test timed out. Try a smaller model in Models or check the selected runtime."}
	case errors.Is(err, speech.ErrNoSpeech):
		result = DiagnosticResult{Phase: "error", Message: "No speech detected. Speak a longer sentence and check the selected microphone."}
	case err != nil:
		result = DiagnosticResult{Phase: "error", Message: "Transcription failed; reinstall the model and its runtime in Models. For a custom runtime, keep its required libraries alongside the executable.", Details: err.Error()}
	case text == "":
		result = DiagnosticResult{Phase: "error", Message: "No speech detected. Speak a longer sentence and check the selected microphone."}
	}
	if removeErr != nil {
		result.Phase, result.Message = "error", "Could not delete test audio. Check access to the app's recordings folder."
		result.Details = removeErr.Error()
		result.Transcript = ""
		result.RawTranscript = ""
	}
	return result
}

func CaptureFailure(err error) DiagnosticResult {
	return DiagnosticResult{Phase: "error", Message: "Could not start microphone capture. Check microphone access, reconnect the input, or choose another microphone in Settings.", Details: err.Error()}
}

func Transcribe(ctx context.Context, engine speech.Engine, path string, settings storage.Settings, entries []vocabulary.Entry) (string, error) {
	return engine.Transcribe(ctx, path, speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath, Language: settings.Language, Prompt: vocabulary.Prompt(entries)})
}
