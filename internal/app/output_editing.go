package app

import (
	"yap/internal/app/history"
	"yap/internal/app/homeresult"
	"yap/internal/storage"
)

// SaveSessionOutput keeps the generation identity and metadata intact and saves
// only while the exact text the editor loaded is still current.
func (a *App) SaveSessionOutput(sessionID, outputID, text, expectedText string) (storage.GeneratedOutput, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return storage.GeneratedOutput{}, err
	}
	output, err := history.EditOutput(a.store, history.Current{ID: a.id, Phase: a.status.Phase}, sessionID, outputID, text, expectedText)
	if err != nil {
		return storage.GeneratedOutput{}, err
	}
	if text == expectedText {
		return output, nil
	}
	// Saved Home results resolve storage again before every versioned action.
	// Keep the current display in sync as well without changing transcript text
	// or any temporary result into a saved History record.
	if result := a.homeResult; result != nil && result.Saved && result.Session.ID == sessionID {
		for i := range result.Outputs {
			if result.Outputs[i].ID == outputID {
				result.Outputs[i] = output
			}
		}
		if result.OutputID == outputID {
			result.Text = output.Text
			result.Outcomes.Clipboard, result.Outcomes.Paste = "skipped", "skipped"
			if a.id == sessionID && a.status.Phase == "done" {
				a.publishHistoryChangeLocked(history.Change{Changed: true, Text: output.Text, Message: "Output updated in History"})
			}
		}
	}
	a.event("dictation:history")
	return output, nil
}

// refreshSavedHomeResultLocked reconciles a saved result with current storage.
// Missing selected outputs fall back to the transcript, including when another
// output survives. The caller owns status publication and any in-flight phase.
func (a *App) refreshSavedHomeResultLocked(sessionID string) (history.Change, error) {
	result := a.homeResult
	if result == nil || !result.Saved || result.Session.ID != sessionID {
		return history.Change{}, nil
	}
	beforeText, beforeOutputID, beforeTranscript := result.Text, result.OutputID, result.Session.FinalTranscript
	resolved, err := homeresult.Resolve(a.store, result, false)
	if err != nil {
		return history.Change{}, err
	}
	a.homeResult = resolved
	if resolved == nil {
		return history.Change{}, nil
	}
	if resolved.Text != beforeText || resolved.OutputID != beforeOutputID {
		resolved.Outcomes.Clipboard, resolved.Outcomes.Paste = "skipped", "skipped"
	}
	message := "Transcript updated in History"
	if resolved.Session.FinalTranscript == beforeTranscript {
		if beforeOutputID != "" && resolved.OutputID == "" {
			message = "Output removed from History"
		} else if resolved.OutputID != "" {
			message = "Output updated in History"
		}
	}
	return history.Change{
		Changed: a.id == sessionID && (a.status.Transcript != resolved.Text || beforeOutputID != resolved.OutputID),
		Text:    resolved.Text, Message: message,
	}, nil
}
