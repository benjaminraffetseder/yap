package main

import "yap/internal/storage"

func (a *App) GetRevisions(kind, itemID string) ([]storage.Revision, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return nil, err
	}
	return a.store.Revisions(kind, itemID)
}
