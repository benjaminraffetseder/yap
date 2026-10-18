package main

import "errors"

// This preference can change during recording; the recording keeps its captured settings.
func (a *App) SetSaveHistory(enabled bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.setSaveHistoryLocked(enabled)
}
func (a *App) setSaveHistoryLocked(enabled bool) error {
	if err := a.available(); err != nil {
		return err
	}
	if a.status.Phase == "backup" {
		return errors.New("finish the backup before changing history preferences")
	}
	settings := a.settings
	settings.SaveHistory = enabled
	if err := a.store.SaveSettings(settings); err != nil {
		return err
	}
	a.settings = settings
	a.emit()
	return nil
}
func (a *App) toggleHistory() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.setSaveHistoryLocked(!a.settings.SaveHistory); err != nil {
		a.status.Message = "Could not change history preference: " + err.Error()
		a.emit()
	}
}
func (a *App) SaveLatestResult(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current dictation before saving")
	}
	if a.latestResult == nil || a.latestResult.Session.ID != id {
		return errors.New("this temporary result is no longer available")
	}
	outputs := a.latestResult.Outputs
	if len(outputs) == 0 && a.latestResult.Output != nil {
		outputs = append(outputs, *a.latestResult.Output)
	}
	if err := a.store.AddWithOutputs(a.latestResult.Session, outputs); err != nil {
		return err
	}
	a.latestResult = nil
	a.pruneHistoryLocked()
	a.status.Message = "Saved to History"
	a.emit()
	a.event("dictation:history")
	return nil
}
func (a *App) DismissLatestResult(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current dictation before dismissing")
	}
	if a.latestResult == nil || a.latestResult.Session.ID != id {
		return errors.New("this temporary result is no longer available")
	}
	a.latestResult = nil
	a.status.Transcript = ""
	a.emit()
	return nil
}
