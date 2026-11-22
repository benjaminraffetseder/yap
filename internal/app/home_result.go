package app

import (
	"errors"

	"yap/internal/app/homeresult"
	"yap/internal/indicator"
	"yap/internal/storage"
)

type HomeOutcomes = homeresult.HomeOutcomes
type HomeResult = homeresult.HomeResult

func (a *App) clearHomeResultLocked() {
	a.homeResult, a.homeResultHidden = nil, false
}

func (a *App) beginHomeResult() (*HomeResult, bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return nil, false, err
	}
	if a.busyLocked() || a.textJobID != "" {
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
	a.finishHomeResult(false)
}

func (a *App) finishHomeResult(changed bool) {
	a.mu.Lock()
	if changed {
		a.invalidateHistoryLocked()
	}
	if !a.closing && !a.legacyHistoryInUse && a.tray != nil && !a.historyPresenceKnown {
		a.mu.Unlock()
		recent, err := a.store.RecentHistory(1)
		a.mu.Lock()
		if err == nil && !a.closing {
			a.historyPresent, a.historyPresenceKnown = len(recent) > 0, true
		}
	}
	// GetSnapshot can subscribe while the tray read is in flight.
	if !a.closing && a.legacyHistoryInUse {
		a.mu.Unlock()
		history, err := a.store.History()
		a.mu.Lock()
		if err == nil && !a.closing {
			a.homeHistory = history
			a.historyPresent, a.historyPresenceKnown = len(history) > 0, true
		}
	}
	a.homeResultOperation = false
	if changed {
		a.retireDeletedHomeResultLocked()
	}
	if a.homeHistoryWait != nil {
		close(a.homeHistoryWait)
		a.homeHistoryWait = nil
	}
	if changed && !a.closing {
		a.emitStatusLocked()
		// The action invalidated History before settling the full legacy cache.
		// Publish that settled state without invalidating its fresh cache again.
		if a.notify != nil {
			a.notify("dictation:history")
		}
	} else {
		a.pumpQueuesLocked()
		if !a.closing {
			a.updateTrayLocked()
		}
	}
	a.mu.Unlock()
	a.wg.Done()
}

func (a *App) resolveHomeResult(result *HomeResult, hidden bool) (*HomeResult, error) {
	return homeresult.Resolve(a.store, result, hidden)
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
	defer a.finishHomeResult(true)
	result, err = a.resolveHomeResult(result, hidden)
	if err != nil {
		return err
	}
	if err := homeresult.Validate(result, id, revision); err != nil {
		return err
	}
	a.mu.Lock()
	err = a.availableLocked()
	a.mu.Unlock()
	if err != nil {
		return err
	}
	outcome, err := homeresult.Apply(a.store, result, action, text, a.settings.HistoryRetentionDays, a.copyText)
	if outcome.HistoryCleanup {
		a.mu.Lock()
		if outcome.CleanupError != nil {
			a.status.HistoryError = "History cleanup could not finish"
		} else {
			a.status.HistoryError = ""
		}
		a.mu.Unlock()
	}
	if err != nil {
		if outcome.PublishOnError {
			a.mu.Lock()
			if !a.closing {
				a.homeResult = result
			}
			a.mu.Unlock()
		}
		return err
	}
	a.mu.Lock()
	if !a.closing {
		if a.indicator != nil {
			a.indicator.Update(indicator.State{Phase: "idle"})
		}
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
