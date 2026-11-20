package recording

import (
	"context"
	"path/filepath"

	"yap/internal/app/homeresult"
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

type TemporaryResult struct {
	Session storage.Session           `json:"session"`
	Output  *storage.GeneratedOutput  `json:"output,omitempty"`
	Text    string                    `json:"text"`
	Outputs []storage.GeneratedOutput `json:"outputs,omitempty"`
}

// Completion owns a recognized result through History, automatic processing,
// and delivery. Its methods run within the caller's operation reservation.
type Completion struct {
	Home      *homeresult.HomeResult
	Temporary *TemporaryResult
	settings  storage.Settings
}

func NewCompletion(id, path string, duration int64, recognized Recognition, settings storage.Settings, entries []vocabulary.Entry, imported bool) *Completion {
	audioPath := ""
	if settings.SaveHistory && settings.SaveAudio {
		audioPath = path
	}
	session := storage.NewSession(id, duration, recognized.Text, filepath.Base(settings.ModelPath), settings.Language, audioPath)
	session.Stats = &storage.SpeechStats{TranscriptionMS: recognized.TranscriptionMS, Engine: speech.Kind(settings.ModelPath)}
	text := ProcessTranscript(recognized.Text, settings, entries)
	session.FinalTranscript = text
	return &Completion{settings: settings, Home: &homeresult.HomeResult{Session: session, Text: text, Imported: imported,
		Outcomes: homeresult.HomeOutcomes{Transcription: "complete", History: "temporary", Processing: "skipped", Clipboard: "skipped", Paste: "skipped"}}}
}

// Save makes the original speech durable before automatic processing begins.
// On failure the text and provenance remain recoverable, but not the audio
// that the operation will discard when it releases its reservation.
func (result *Completion) Save(add func(storage.Session) error) error {
	if result.settings.SaveHistory {
		if err := add(result.Home.Session); err != nil {
			result.Home.Session.AudioPath = ""
			result.Temporary = &TemporaryResult{Session: result.Home.Session, Text: result.Home.Text}
			result.Home.Outcomes.History = "failed"
			return err
		}
		result.Home.Saved, result.Home.Outcomes.History = true, "saved"
	} else {
		result.Temporary = &TemporaryResult{Session: result.Home.Session, Text: result.Home.Text}
	}
	return nil
}

func (result *Completion) DiscardAudio() bool {
	return !result.Home.Saved || !result.settings.SaveAudio
}

func (result *Completion) SessionID() string {
	if result.Home.Saved {
		return result.Home.Session.ID
	}
	return ""
}

func (result *Completion) GenerateTitle(config textmodel.Config) bool {
	return result.Home.Saved && result.settings.AutoGenerateTitles && config.Enabled
}

func (result *Completion) AutomaticRecipe(config textmodel.Config) (textmodel.Chain, bool, error) {
	if !config.Enabled || config.AutoPromptID == "" {
		return textmodel.Chain{}, false, nil
	}
	result.Home.Outcomes.Processing = "pending"
	recipe, err := config.Recipe(config.AutoPromptID)
	return recipe, true, err
}

// CommitOutput journals each successful step before a dependent step runs.
// A persistence failure must not make an unsaved output appear durable in Home.
func (result *Completion) CommitOutput(output storage.GeneratedOutput, add func(storage.GeneratedOutput) error) error {
	if result.Home.Saved {
		if err := add(output); err != nil {
			return err
		}
	}
	result.Home.Outputs = append(result.Home.Outputs, output)
	if result.Temporary != nil {
		result.Temporary.Outputs = append(result.Temporary.Outputs, output)
		result.Temporary.Output = &output
	}
	return nil
}

type Outcome struct {
	Message    string
	Transcript string
	Warning    bool
}

func (result *Completion) HistoryFailure() Outcome {
	return Outcome{Message: "Transcript ready; History save failed. Save or copy it from Home.", Transcript: result.Home.Text, Warning: true}
}

// FinishProcessing preserves the durable speech and all committed steps when
// processing fails or is cancelled. Only a complete recipe becomes delivery text.
func (result *Completion) FinishProcessing(ctxErr error, processed string, err error) (Outcome, bool) {
	if ctxErr != nil {
		result.Home.Outcomes.Processing = "cancelled"
		message := "Text processing cancelled; transcript available"
		if result.Home.Saved {
			message = "Text processing cancelled; transcript saved to History"
		}
		return Outcome{Message: message, Transcript: result.Home.Text, Warning: true}, false
	}
	if err == nil {
		err = textmodel.ValidateText(processed)
	}
	if err != nil {
		result.Home.Outcomes.Processing = "failed"
		message := "Text processing failed; transcript available in Home"
		if result.Home.Saved {
			message = "Saved to History; text processing failed. Transcript available in Home."
		}
		return Outcome{Message: message, Transcript: result.Home.Text, Warning: true}, false
	}
	if result.Temporary != nil {
		result.Temporary.Text = processed
	}
	result.Home.Text, result.Home.Outcomes.Processing = processed, "complete"
	if len(result.Home.Outputs) > 0 {
		result.Home.OutputID = result.Home.Outputs[len(result.Home.Outputs)-1].ID
	}
	return Outcome{Transcript: processed}, true
}

type Delivery struct {
	Copied   bool
	CopyErr  error
	PasteErr error
}

// Deliver runs outside the application lock. Context-aware copy takes priority
// and cancellation prevents an automatic paste after the copy completes.
func Deliver(ctx context.Context, text, target string, copy func(string) error, copyContext func(context.Context, string) error, paste func(string) error) Delivery {
	result := Delivery{Copied: true}
	if copyContext != nil {
		result.CopyErr = copyContext(ctx, text)
	} else {
		result.CopyErr = copy(text)
	}
	if result.CopyErr == nil && target != "" && ctx.Err() == nil {
		result.PasteErr = paste(target)
	}
	return result
}

// FinishDelivery rechecks cancellation under the caller's lock so a late
// cancellation never advertises a paste request for an interrupted operation.
func (result *Completion) FinishDelivery(delivery Delivery, target string, ctxErr error) Outcome {
	outcome := Outcome{Message: "Not saved to History", Transcript: result.Home.Text}
	if result.Home.Saved {
		outcome.Message = "Saved to History"
	}
	if !delivery.Copied {
		return outcome
	}
	outcome.Message = "Copied to clipboard"
	if delivery.CopyErr != nil {
		result.Home.Outcomes.Clipboard = "failed"
		outcome.Warning = true
		outcome.Message = "Clipboard failed; transcript available in Home"
		if result.Home.Saved {
			outcome.Message = "Saved to History; clipboard failed. Transcript available in Home."
		}
		return outcome
	}
	result.Home.Outcomes.Clipboard = "complete"
	if target != "" && ctxErr == nil {
		if delivery.PasteErr != nil {
			result.Home.Outcomes.Paste = "failed"
			outcome.Warning = true
			outcome.Message = "Automatic paste failed; copied to clipboard. Paste manually."
		} else {
			result.Home.Outcomes.Paste = "requested"
			outcome.Message = "Paste requested; copied to clipboard"
		}
	}
	return outcome
}
