package main

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

func (a *App) clearHomeResultLocked() {
	a.homeResult, a.homeResultHidden = nil, false
}

func (a *App) beginHomeResult() (*HomeResult, bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return nil, false, err
	}
	if a.busy() || a.textJobID != "" {
		return nil, false, errors.New("finish the current operation before using the result")
	}
	a.homeResultOperation = true
	a.wg.Add(1)
	var result *HomeResult
	if a.homeResult != nil {
		copy := *a.homeResult
		copy.Outputs = append([]storage.GeneratedOutput{}, copy.Outputs...)
		result = &copy
	} else if a.latestResult != nil {
		outputs := append([]storage.GeneratedOutput{}, a.latestResult.Outputs...)
		if len(outputs) == 0 && a.latestResult.Output != nil {
			outputs = append(outputs, *a.latestResult.Output)
		}
		result = &HomeResult{Session: a.latestResult.Session, Text: a.latestResult.Text, Outputs: outputs,
			Outcomes: HomeOutcomes{Transcription: "complete", History: "temporary", Processing: "skipped", Clipboard: "unknown", Paste: "unknown"}}
	}
	return result, a.homeResultHidden, nil
}

func (a *App) endHomeResult() {
	history, err := a.store.History()
	a.mu.Lock()
	if err == nil && !a.closing {
		a.homeHistory = history
	}
	a.homeResultOperation = false
	a.pumpImportQueueLocked()
	a.mu.Unlock()
	a.wg.Done()
}

// The operation owns a lease across reads, persistence and cleanup. External
// callers either use cached History or fail promptly; SQLite never owns App.mu.
func (a *App) resolveHomeResult(result *HomeResult, hidden bool) (*HomeResult, error) {
	if hidden {
		return nil, nil
	}
	if result == nil {
		history, err := a.store.History()
		if err != nil || len(history) == 0 {
			return nil, err
		}
		result = &HomeResult{Session: history[0], Saved: true, Text: history[0].FinalTranscript,
			Outcomes: HomeOutcomes{Transcription: "complete", History: "saved", Processing: "unknown", Clipboard: "unknown", Paste: "unknown"}}
	}
	if result.Saved {
		session, err := a.store.Session(result.Session.ID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		outputs, err := a.store.GeneratedOutputs(session.ID)
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

func (a *App) GetHomeResult() (*HomeResult, error) {
	// Navigation and Strict Mode can overlap reads. Wait outside App.mu so a
	// superseded request cannot make the current Home view fail as "busy".
	a.homeResultReadMu.Lock()
	defer a.homeResultReadMu.Unlock()
	result, hidden, err := a.beginHomeResult()
	if err != nil {
		return nil, err
	}
	defer a.endHomeResult()
	return a.resolveHomeResult(result, hidden)
}

// Every action resolves the current session AND outputs again. A stale editor,
// toast, retry or double click cannot write/copy a newer or deleted result.
func (a *App) HomeResultAction(id, revision, action, text string) error {
	result, hidden, err := a.beginHomeResult()
	if err != nil {
		return err
	}
	defer func() {
		a.endHomeResult()
		a.mu.Lock()
		if !a.closing {
			a.emit()
			a.event("dictation:history")
		}
		a.mu.Unlock()
	}()
	result, err = a.resolveHomeResult(result, hidden)
	if err != nil {
		return err
	}
	if result == nil || result.Session.ID != id || result.Revision != revision {
		return errors.New("this result changed or is no longer available; reopen the latest result")
	}
	a.mu.Lock()
	err = a.available()
	a.mu.Unlock()
	if err != nil {
		return err
	}
	switch {
	case action == "edit":
		if err := textmodel.ValidateText(text); err != nil {
			return err
		}
		if result.Saved {
			if err := a.store.UpdateTranscript(id, text); err != nil {
				return errors.New("could not update History; your draft is still available")
			}
		}
		result.Session.FinalTranscript, result.Text, result.OutputID = text, text, ""
		result.Outcomes.Clipboard, result.Outcomes.Paste = "skipped", "skipped"
	case action == "save":
		if result.Saved {
			return errors.New("this result is already saved")
		}
		if err := a.store.AddWithOutputs(result.Session, result.Outputs); err != nil {
			return errors.New("could not save to History; the temporary result is still available")
		}
		result.Saved, result.Outcomes.History = true, "saved"
		// Cleanup stays within the reservation, without App.mu.
		_, cleanupErr := a.store.PruneHistory(a.settings.HistoryRetentionDays, time.Now())
		a.mu.Lock()
		if cleanupErr != nil {
			a.status.HistoryError = "History cleanup could not finish"
		} else {
			a.status.HistoryError = ""
		}
		a.mu.Unlock()
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
				return errors.New("this output is no longer available")
			}
		}
		if err := a.copyText(copyText); err != nil {
			if action == "copy" {
				result.Outcomes.Clipboard = "failed"
				a.mu.Lock()
				if !a.closing {
					a.homeResult = result
				}
				a.mu.Unlock()
			}
			return errors.New("could not copy; your result is still available")
		}
		if action == "copy" {
			result.Outcomes.Clipboard = "complete"
		}
	default:
		return errors.New("unknown result action")
	}
	a.mu.Lock()
	if !a.closing {
		if action == "dismiss" {
			a.homeResult, a.latestResult, a.homeResultHidden = nil, nil, true
			if a.id == id {
				a.status.Transcript = ""
			}
		} else {
			a.homeResult = result
			if !result.Saved && a.latestResult != nil && a.latestResult.Session.ID == id {
				a.latestResult.Session, a.latestResult.Text = result.Session, result.Text
			}
			if action == "save" {
				a.latestResult = nil
				if a.id == id && a.status.Phase == "done" {
					a.status.Message = "Saved to History"
				}
			}
			if action == "edit" && a.id == id && a.status.Phase == "done" {
				a.status.Transcript = result.Text
			}
		}
	}
	a.mu.Unlock()
	return nil
}
