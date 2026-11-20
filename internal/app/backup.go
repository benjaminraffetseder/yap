package app

import (
	"context"
	"errors"
	"time"

	"yap/internal/app/backups"
	"yap/internal/storage"
)

func (a *App) backupAvailableLocked() error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() || a.textJobID != "" {
		return errors.New("finish the current operation before using backups")
	}
	return nil
}

// Register the operation before releasing the lock; shutdown waits for file/DB
// work and recording/settings changes remain blocked while it runs.
func (a *App) beginBackupLocked(message string) (Status, context.Context, error) {
	history, err := a.store.History()
	if err != nil {
		return Status{}, nil, err
	}
	previous := a.status
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancel = cancel
	a.backupHistory = history
	a.status.Phase, a.status.Message = "backup", message
	a.status.StartedAt = time.Now().UnixMilli()
	a.wg.Add(1)
	a.emitStatusLocked()
	return previous, ctx, nil
}
func (a *App) finishBackupLocked(previous Status) {
	a.cancel()
	a.cancel = nil
	a.backups.Finish()
	a.backupHistory = nil
	a.status = previous
	a.emitStatusLocked()
	// Retry any History reads that were blocked while the backup owned SQLite.
	if !a.closing {
		a.event("dictation:history")
	}
}

func (a *App) ExportBackup(includeAudio bool) (*storage.BackupSummary, error) {
	a.mu.Lock()
	err := a.backupAvailableLocked()
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	path, err := a.saveFile("Export Yap backup", "yap-"+time.Now().Format("2006-01-02")+".yap-backup.zip", "Yap backup", "*.zip")
	if err != nil || path == "" {
		return nil, err
	}
	return a.exportBackup(path, includeAudio)
}
func (a *App) exportBackup(path string, includeAudio bool) (*storage.BackupSummary, error) {
	a.mu.Lock()
	if err := a.backupAvailableLocked(); err != nil {
		a.mu.Unlock()
		return nil, err
	}
	previous, ctx, err := a.beginBackupLocked("Creating backup…")
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	defer a.wg.Done()
	summary, err := backups.Export(ctx, a.store, path, includeAudio)
	a.mu.Lock()
	a.finishBackupLocked(previous)
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return summary, nil
}

func (a *App) PreviewBackup() (*storage.BackupPreview, error) {
	a.mu.Lock()
	err := a.backupAvailableLocked()
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	path, err := a.openFile("Select Yap backup", "Yap backup", "*.zip")
	if err != nil || path == "" {
		return nil, err
	}
	return a.previewBackup(path)
}
func (a *App) previewBackup(path string) (*storage.BackupPreview, error) {
	a.mu.Lock()
	if err := a.backupAvailableLocked(); err != nil {
		a.mu.Unlock()
		return nil, err
	}
	_ = a.backups.Close()
	previous, ctx, err := a.beginBackupLocked("Checking backup…")
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	defer a.wg.Done()
	preview, err := backups.Inspect(ctx, a.store, path)
	a.mu.Lock()
	defer a.mu.Unlock()
	// Check under the same lock as Cancel before publishing the preview.
	if err == nil {
		err = ctx.Err()
	}
	if err != nil && ctx.Err() != nil {
		err = errors.New("backup check cancelled")
	}
	a.finishBackupLocked(previous)
	if err != nil || a.closing {
		_ = preview.Close()
		if err == nil {
			err = errors.New("app is shutting down")
		}
		return nil, err
	}
	return a.backups.Publish(preview), nil
}

func (a *App) DiscardBackupPreview(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing {
		return nil
	}
	return a.backups.Discard(id, a.status.Phase == "backup")
}

func (a *App) RestoreBackup(id string, preferences bool) (storage.BackupSummary, error) {
	a.mu.Lock()
	if err := a.backupAvailableLocked(); err != nil {
		a.mu.Unlock()
		return storage.BackupSummary{}, err
	}
	archive, err := a.backups.Archive(id)
	if err != nil {
		a.mu.Unlock()
		return storage.BackupSummary{}, err
	}
	previous, ctx, err := a.beginBackupLocked("Restoring backup…")
	a.mu.Unlock()
	if err != nil {
		return storage.BackupSummary{}, err
	}
	defer a.wg.Done()
	result, err := backups.Restore(ctx, a.store, archive, preferences)
	a.mu.Lock()
	defer a.mu.Unlock()
	if err == nil {
		// Startup reconciles some machine settings in memory. A SQL snapshot
		// cannot replace those effective values, even on a portable restore.
		if preferences {
			a.settings = backups.PortableSettings(a.settings, result.Settings)
		}
		a.textConfig, a.vocabulary = result.TextProcessing, result.Vocabulary
		a.diagnostic = DiagnosticResult{}
		_ = a.backups.Close()
	}
	a.finishBackupLocked(previous)
	if err == nil && !a.closing {
		a.event("setup:changed")
	}
	return result.Summary, err
}
