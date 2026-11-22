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

// GetRecentHistory is the small, on-demand command-menu read. Routine runtime
// refreshes do not need historical transcript payloads.
func (a *App) GetRecentHistory() ([]storage.Session, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	// A Home action can change the rows, and even a read-only Home lease can
	// overlap the first palette request. Wait for release before choosing the
	// current source, including a backup that may have started in the meantime.
	for a.homeResultOperation && !a.closing {
		if a.homeHistoryWait == nil {
			a.homeHistoryWait = make(chan struct{})
		}
		released := a.homeHistoryWait
		a.mu.Unlock()
		<-released
		a.mu.Lock()
	}
	if err := a.availableLocked(); err != nil {
		return nil, err
	}
	const limit = 5
	if a.status.Phase == "backup" {
		return cloneHistory(a.backupHistory[:min(len(a.backupHistory), limit)]), nil
	}
	store := a.store
	a.wg.Add(1)
	defer a.wg.Done()
	a.mu.Unlock()
	recent, err := store.RecentHistory(limit)
	a.mu.Lock()
	return recent, err
}

func cloneHistory(history []storage.Session) []storage.Session {
	result := make([]storage.Session, len(history))
	copy(result, history)
	for i, session := range result {
		if session.Stats != nil {
			stats := *session.Stats
			result[i].Stats = &stats
		}
	}
	return result
}

// GetHistorySelectionIDs reconciles all-matching selection without creating
// an export preview or reading generated outputs.
func (a *App) GetHistorySelectionIDs(query string) ([]string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return nil, err
	}
	return a.store.MatchingHistoryIDs(query)
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

func (a *App) PermanentlyDeleteSessionsWithResult(ids []string) (storage.PermanentDeletionResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return storage.PermanentDeletionResult{}, err
	}
	result, err := a.store.PermanentlyDeleteSessionsWithResult(ids)
	a.event("dictation:history")
	return result, err
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

func (a *App) invalidateHistoryLocked() {
	// Only a full legacy read can make this cache valid again. Tray presence
	// and focused recent reads cannot certify all cached rows after a mutation.
	a.homeHistory = nil
	a.historyPresenceKnown = false
}

func (a *App) retireDeletedHomeResultLocked() {
	if a.store == nil || a.closing || a.homeResultOperation || a.status.Phase == "backup" || a.homeResult == nil || !a.homeResult.Saved {
		return
	}
	if exists, err := a.store.HasActiveSession(a.homeResult.Session.ID); err == nil && !exists {
		// Keep dismissal and temporary results separate from a saved row that
		// left active History. A nil identity permits the normal recent fallback.
		a.homeResult = nil
	}
}

func (a *App) publishHistoryChangeLocked(change history.Change) {
	if change.Changed {
		a.status.Transcript, a.status.Message = change.Text, change.Message
		a.emitStatusLocked()
	}
}
