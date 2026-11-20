// Package homeresult owns current-result resolution, revisions and user actions.
package homeresult

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

// Outcomes contain only stage states, never transcript text, source paths or
// provider errors. "requested" means input was sent, not accepted by an app.
type HomeOutcomes struct {
	Transcription string `json:"transcription"`
	History       string `json:"history"`
	Processing    string `json:"processing"`
	Clipboard     string `json:"clipboard"`
	Paste         string `json:"paste"`
}

// HomeResult is separate from the legacy, temporary-only latestResult snapshot.
type HomeResult struct {
	Session  storage.Session           `json:"session"`
	Outputs  []storage.GeneratedOutput `json:"outputs"`
	Text     string                    `json:"text"`
	OutputID string                    `json:"outputId"`
	Revision string                    `json:"revision"`
	Saved    bool                      `json:"saved"`
	Imported bool                      `json:"imported"`
	Outcomes HomeOutcomes              `json:"outcomes"`
}

// The operation owns a lease across reads, persistence and cleanup. External
// callers either use cached History or fail promptly; SQLite never owns App.mu.
func Resolve(store *storage.Store, result *HomeResult, hidden bool) (*HomeResult, error) {
	if hidden {
		return nil, nil
	}
	if result == nil {
		history, err := store.History()
		if err != nil || len(history) == 0 {
			return nil, err
		}
		result = &HomeResult{Session: history[0], Saved: true, Text: history[0].FinalTranscript,
			Outcomes: HomeOutcomes{Transcription: "complete", History: "saved", Processing: "unknown", Clipboard: "unknown", Paste: "unknown"}}
	}
	if result.Saved {
		session, err := store.Session(result.Session.ID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		outputs, err := store.GeneratedOutputs(session.ID)
		if err != nil {
			return nil, err
		}
		if session.FinalTranscript != result.Session.FinalTranscript {
			result.Text, result.OutputID = session.FinalTranscript, ""
			result.Outcomes.Clipboard, result.Outcomes.Paste = "skipped", "skipped"
		}
		result.Session, result.Outputs = session, outputs
		if result.OutputID != "" {
			found := false
			for _, output := range outputs {
				if output.ID == result.OutputID {
					result.Text, found = output.Text, true
				}
			}
			if !found {
				result.Text, result.OutputID = session.FinalTranscript, ""
				result.Outcomes.Clipboard, result.Outcomes.Paste = "skipped", "skipped"
			}
		}
	}
	result.Revision = ""
	data, _ := json.Marshal(result)
	result.Revision = fmt.Sprintf("%x", sha256.Sum256(data))
	return result, nil
}

// ActionOutcome carries coordinator effects without exposing application state.
type ActionOutcome struct {
	HistoryCleanup bool
	CleanupError   error
	PublishOnError bool
}

func Validate(result *HomeResult, id, revision string) error {
	if result == nil || result.Session.ID != id || result.Revision != revision {
		return errors.New("this result changed or is no longer available; reopen the latest result")
	}
	return nil
}

// Apply runs within the caller's result reservation, without its application lock.
func Apply(store *storage.Store, result *HomeResult, action, text string, retentionDays int, copyToClipboard func(string) error) (ActionOutcome, error) {
	outcome := ActionOutcome{}
	switch {
	case action == "edit":
		if err := textmodel.ValidateText(text); err != nil {
			return outcome, err
		}
		if result.Saved {
			if err := store.UpdateTranscript(result.Session.ID, text); err != nil {
				return outcome, errors.New("could not update History; your draft is still available")
			}
		}
		result.Session.FinalTranscript, result.Text, result.OutputID = text, text, ""
		result.Outcomes.Clipboard, result.Outcomes.Paste = "skipped", "skipped"
	case action == "save":
		if result.Saved {
			return outcome, errors.New("this result is already saved")
		}
		if err := store.AddWithOutputs(result.Session, result.Outputs); err != nil {
			return outcome, errors.New("could not save to History; the temporary result is still available")
		}
		result.Saved, result.Outcomes.History = true, "saved"
		// Cleanup stays within the reservation, without App.mu.
		_, cleanupErr := store.PruneHistory(retentionDays, time.Now())
		outcome.HistoryCleanup, outcome.CleanupError = true, cleanupErr
	case action == "dismiss":
		// Hide the Home card without changing its saved History entry.
	case action == "copy" || strings.HasPrefix(action, "copy:"):
		copyText := result.Text
		if action != "copy" {
			found := false
			for _, output := range result.Outputs {
				if output.ID == strings.TrimPrefix(action, "copy:") {
					copyText, found = output.Text, true
				}
			}
			if !found {
				return outcome, errors.New("this output is no longer available")
			}
		}
		if err := copyToClipboard(copyText); err != nil {
			if action == "copy" {
				result.Outcomes.Clipboard = "failed"
				outcome.PublishOnError = true
			}
			return outcome, errors.New("could not copy; your result is still available")
		}
		if action == "copy" {
			result.Outcomes.Clipboard = "complete"
		}
	default:
		return outcome, errors.New("unknown result action")
	}
	return outcome, nil
}
