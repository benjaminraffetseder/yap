package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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

func (a *App) GetSession(id string) (*storage.Session, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return nil, err
	}
	entry, err := a.store.Session(id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

func (a *App) DeleteSessions(ids []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	if a.status.Phase == "transcribing" {
		for _, id := range ids {
			if id == a.id {
				return errors.New("finish the current dictation before deleting its transcript")
			}
		}
	}
	_, err := a.store.DeleteSessions(ids)
	a.clearDeletedResultLocked()
	a.event("dictation:history") // Also refresh after a partially failed audio cleanup.
	return err
}

func formatHistoryExport(entries []storage.Session) string {
	var text strings.Builder
	for _, entry := range entries {
		fmt.Fprintf(&text, "%s · %s · %s\n%s\n\n", entry.CreatedAt, entry.SpeechModel, entry.Language, entry.FinalTranscript)
	}
	return text.String()
}

func (a *App) ExportSessions(ids []string) error {
	a.mu.Lock()
	if err := a.historyAvailableLocked(); err != nil {
		a.mu.Unlock()
		return err
	}
	entries, err := a.store.SelectedSessions(ids)
	a.mu.Unlock()
	if err != nil {
		return err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Export selected dictations", DefaultFilename: "yap-history.txt", Filters: []runtime.FileFilter{{DisplayName: "Text", Pattern: "*.txt"}}})
	if err != nil || path == "" {
		return err
	}
	return os.WriteFile(path, []byte(formatHistoryExport(entries)), 0600)
}

// Retention failures must be visible without turning a saved dictation into a
// transcription error. The persisted policy is retried on the next cleanup.
func (a *App) pruneHistoryLocked() {
	if a.store == nil || a.closing {
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
	if a.id == "" || a.status.Phase != "done" {
		return
	}
	if _, err := a.store.Session(a.id); errors.Is(err, sql.ErrNoRows) {
		a.status.Transcript = ""
		a.status.Message = "Dictation removed from History"
		a.emit()
	}
}
