package main

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"yap/internal/storage"
)

func (a *App) backupAvailableLocked() error {
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() || a.textJobID != "" {
		return errors.New("finish the current operation before using backups")
	}
	return nil
}

// Never wait for a backup transaction while holding the application mutex:
// cancellation and shutdown need that mutex to release the transaction.
func (a *App) historyAvailableLocked() error {
	if err := a.available(); err != nil {
		return err
	}
	if a.status.Phase == "backup" {
		return errors.New("finish or cancel the backup before accessing History")
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
	a.emit()
	return previous, ctx, nil
}
func (a *App) finishBackupLocked(previous Status) {
	a.cancel()
	a.cancel = nil
	if a.discardBackupAfterOperation && a.pendingBackup != nil {
		a.pendingBackup.Close()
		a.pendingBackup, a.backupPreviewID = nil, ""
	}
	a.discardBackupAfterOperation = false
	a.backupHistory = nil
	a.status = previous
	a.emit()
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
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Export Yap backup", DefaultFilename: "yap-" + time.Now().Format("2006-01-02") + ".yap-backup.zip", Filters: []runtime.FileFilter{{DisplayName: "Yap backup", Pattern: "*.zip"}}})
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
	summary, err := a.store.ExportBackup(ctx, path, includeAudio)
	if err != nil && ctx.Err() != nil {
		err = errors.New("backup cancelled; no changes were saved")
	}
	a.mu.Lock()
	a.finishBackupLocked(previous)
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func (a *App) PreviewBackup() (*storage.BackupPreview, error) {
	a.mu.Lock()
	err := a.backupAvailableLocked()
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Select Yap backup", Filters: []runtime.FileFilter{{DisplayName: "Yap backup", Pattern: "*.zip"}}})
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
	if a.pendingBackup != nil {
		a.pendingBackup.Close()
		a.pendingBackup = nil
		a.backupPreviewID = ""
	}
	previous, ctx, err := a.beginBackupLocked("Checking backup…")
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	defer a.wg.Done()
	archive, err := storage.ReadBackup(ctx, path)
	var summary storage.BackupSummary
	if err == nil {
		summary, err = a.store.PreviewBackup(ctx, archive)
	}
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
		if archive != nil {
			archive.Close()
		}
		if err == nil {
			err = errors.New("app is shutting down")
		}
		return nil, err
	}
	a.pendingBackup, a.backupPreviewID = archive, uuid.NewString()
	preview := archive.Preview(summary, path)
	preview.ID = a.backupPreviewID
	return &preview, nil
}

func (a *App) DiscardBackupPreview(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing {
		return nil
	}
	if id != a.backupPreviewID || a.pendingBackup == nil {
		return nil
	}
	if a.status.Phase == "backup" {
		a.discardBackupAfterOperation = true
		return nil
	}
	err := a.pendingBackup.Close()
	a.pendingBackup, a.backupPreviewID = nil, ""
	return err
}

func (a *App) RestoreBackup(id string, preferences bool) (storage.BackupSummary, error) {
	a.mu.Lock()
	if err := a.backupAvailableLocked(); err != nil {
		a.mu.Unlock()
		return storage.BackupSummary{}, err
	}
	if id == "" || id != a.backupPreviewID || a.pendingBackup == nil {
		a.mu.Unlock()
		return storage.BackupSummary{}, errors.New("select and preview a backup before restoring")
	}
	archive := a.pendingBackup
	previous, ctx, err := a.beginBackupLocked("Restoring backup…")
	a.mu.Unlock()
	if err != nil {
		return storage.BackupSummary{}, err
	}
	defer a.wg.Done()
	result, err := a.store.RestoreBackup(ctx, archive, preferences)
	if err != nil && ctx.Err() != nil {
		err = errors.New("restore cancelled; no changes were saved")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err == nil {
		// Startup reconciles some machine settings in memory. A SQL snapshot
		// cannot replace those effective values, even on a portable restore.
		if preferences {
			v := result.Settings
			a.settings.Language, a.settings.Interaction, a.settings.AutoPaste, a.settings.SaveAudio, a.settings.CleanText = v.Language, v.Interaction, v.AutoPaste, v.SaveAudio, v.CleanText
		}
		a.textConfig, a.vocabulary = result.TextProcessing, result.Vocabulary
		a.diagnostic = DiagnosticResult{}
		archive.Close()
		a.pendingBackup, a.backupPreviewID = nil, ""
	}
	a.finishBackupLocked(previous)
	if err == nil && !a.closing {
		a.event("setup:changed")
	}
	return result.Summary, err
}
