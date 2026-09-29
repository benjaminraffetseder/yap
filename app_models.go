package main

import (
	"errors"
	"yap/internal/models"
)

func (a *App) RemoveModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation before removing a model")
	}
	if err := models.Remove(a.store.Dir, id, a.settings.ModelPath); err != nil {
		return err
	}
	a.event("dictation:history")
	return nil
}
