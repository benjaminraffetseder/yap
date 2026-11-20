package app

import (
	"time"

	"yap/internal/app/history"
	"yap/internal/storage"
)

func (a *App) GetHistory(query string, page int) (storage.HistoryPage, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return storage.HistoryPage{}, err
	}
	return a.store.SearchHistory(query, page)
}

func (a *App) GetRecentlyDeleted(query string, page int) (storage.HistoryPage, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return storage.HistoryPage{}, err
	}
	a.pruneHistoryLocked()
	return a.store.SearchRecentlyDeleted(query, page)
}

func (a *App) GetSortedHistory(query string, page int, sortBy string, descending, deleted bool) (storage.HistoryPage, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return storage.HistoryPage{}, err
	}
	if deleted {
		a.pruneHistoryLocked()
	}
	return a.store.SearchSortedHistory(query, page, sortBy, descending, deleted)
}

func (a *App) RestoreSessions(ids []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	if err := a.store.RestoreSessions(ids, time.Now()); err != nil {
		return err
	}
	a.event("dictation:history")
	return nil
}

func (a *App) PermanentlyDeleteSessions(ids []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	_, err := a.store.PermanentlyDeleteSessions(ids)
	a.event("dictation:history") // Refresh even if audio cleanup only partially succeeded.
	return err
}

func (a *App) GetSession(id string) (*storage.Session, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return nil, err
	}
	return history.Session(a.store, id)
}

func (a *App) RenameSession(id, title string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	if err := a.store.SaveSessionTitle(id, title); err != nil {
		return err
	}
	a.event("dictation:history")
	return nil
}

func (a *App) DeleteSessions(ids []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	change, err := history.Trash(a.store, history.Current{ID: a.id, Phase: a.status.Phase}, ids)
	if !change.Refresh {
		return err
	}
	a.publishHistoryChangeLocked(change)
	a.event("dictation:history")
	return err
}

// Run while the desktop app stays open, including when hidden in the tray.
// Startup and normal history cleanup also catch expiry after time spent closed.
func (a *App) scheduleHistoryCleanupLocked() {
	a.historyCleanupTimer = time.AfterFunc(time.Hour, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.closing {
			return
		}
		previousError := a.status.HistoryError
		a.pruneHistoryLocked()
		if previousError != a.status.HistoryError {
			a.emitStatusLocked()
		}
		a.scheduleHistoryCleanupLocked()
	})
}

// Retention failures must be visible without turning a saved dictation into a
// transcription error. The persisted policy is retried on the next cleanup.
func (a *App) pruneHistoryLocked() {
	if a.store == nil || a.closing || a.homeResultOperation || a.status.Phase == "backup" {
		return
	}
	count, err := a.store.PruneHistory(a.settings.HistoryRetentionDays, time.Now())
	a.status.HistoryError = ""
	if err != nil {
		a.status.HistoryError = err.Error()
	}
	if count > 0 {
		a.clearDeletedResultLocked()
		a.event("dictation:history")
	}
}

func (a *App) clearDeletedResultLocked() {
	a.publishHistoryChangeLocked(history.Removed(a.store, history.Current{ID: a.id, Phase: a.status.Phase}))
}

func (a *App) publishHistoryChangeLocked(change history.Change) {
	if change.Changed {
		a.status.Transcript, a.status.Message = change.Text, change.Message
		a.emitStatusLocked()
	}
}
