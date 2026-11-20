package app

import (
	"yap/internal/app/history"
)

func (a *App) CopyText(text string) error { return a.copyText(text) }
func (a *App) SaveTranscript(id, text string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.saveTranscriptLocked(id, text)
}

func (a *App) saveTranscriptLocked(id, text string) error {
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	change, err := history.Edit(a.store, history.Current{ID: a.id, Phase: a.status.Phase}, id, text)
	if err != nil {
		return err
	}
	a.publishHistoryChangeLocked(change)
	a.event("dictation:history")
	return nil
}
func (a *App) DeleteSession(id string) error {
	return a.DeleteSessions([]string{id})
}
func (a *App) GetAudio(id string) (string, error) {
	a.mu.Lock()
	if err := a.historyAvailableLocked(); err != nil {
		a.mu.Unlock()
		return "", err
	}
	audio, err := history.PrepareAudio(a.store, id)
	a.mu.Unlock()
	if err != nil {
		return "", err
	}
	return audio.Read()
}
