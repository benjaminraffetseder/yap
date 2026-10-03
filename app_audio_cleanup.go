package main

// Called with app state locked. The durable journal retains ownership on error.
func (a *App) discardAudioLocked(path string) error {
	if path == "" || a.store == nil {
		return nil
	}
	err := a.store.DiscardAudio(path)
	if err != nil {
		a.status.HistoryError = "Could not delete temporary audio: " + err.Error()
		a.emit()
	}
	return err
}
