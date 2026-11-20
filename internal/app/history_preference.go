package app

import (
	"errors"

	"yap/internal/app/preferences"
)

// This preference can change during recording; the recording keeps its captured settings.
func (a *App) SetSaveHistory(enabled bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.setSaveHistoryLocked(enabled)
}
func (a *App) setSaveHistoryLocked(enabled bool) error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	if err := preferences.HistoryChangeAllowed(a.shortcuts.Registering(), a.homeResultOperation, a.status.Phase == "backup"); err != nil {
		return err
	}
	settings := a.settings
	settings.SaveHistory = enabled
	if err := a.store.SaveSettings(settings); err != nil {
		return err
	}
	a.settings = settings
	a.emitStatusLocked()
	a.event("setup:changed", []string{"configuration"})
	return nil
}
func (a *App) toggleHistory() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.setSaveHistoryLocked(!a.settings.SaveHistory); err != nil {
		a.status.Message = "Could not change history preference: " + err.Error()
		a.emitStatusLocked()
	}
}
func (a *App) SaveLatestResult(id string) error {
	result, err := a.GetHomeResult()
	if err != nil {
		return err
	}
	if result == nil || result.Saved || result.Session.ID != id {
		return errors.New("this temporary result is no longer available")
	}
	return a.HomeResultAction(id, result.Revision, "save", "")
}
func (a *App) DismissLatestResult(id string) error {
	result, err := a.GetHomeResult()
	if err != nil {
		return err
	}
	if result == nil || result.Saved || result.Session.ID != id {
		return errors.New("this temporary result is no longer available")
	}
	return a.HomeResultAction(id, result.Revision, "dismiss", "")
}
