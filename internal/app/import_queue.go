package app

import (
	"time"

	"yap/internal/app/imports"
	"yap/internal/models"
)

type ImportJob = imports.ImportJob

func (a *App) importSnapshotLocked() []ImportJob { return a.imports.Snapshot() }

func (a *App) emitImportQueueLocked() {
	if !a.closing {
		a.updateTrayLocked()
		a.event("import:queue", a.importSnapshotLocked())
	}
}

func (a *App) pumpImportQueueLocked() {
	if a.closing || a.busyLocked() || a.textJobID != "" || a.bulkText.ActiveID() != "" {
		return
	}
	if a.imports.Schedule() {
		// Include the scheduled start in shutdown's wait before unlocking.
		a.wg.Add(1)
		go a.startNextImport()
	}
}

func (a *App) startNextImport() {
	defer a.wg.Done()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.imports.ResetPending()
	if a.closing || a.busyLocked() || a.textJobID != "" || a.imports.ActiveID() != "" || a.bulkText.ActiveID() != "" {
		return
	}
	if id := a.imports.Next(); id != "" {
		if err := a.importAudioWithDecoderLocked(id); err != nil {
			a.imports.FailStart(id, err)
			a.emitImportQueueLocked()
			a.pumpQueuesLocked()
		}
		return
	}
	// A scheduled import may have been removed before acquiring the lock.
	a.pumpBulkTextQueueLocked()
}

func (a *App) importProgress(id string, progress float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.closing && a.imports.Progress(id, progress, time.Now()) {
		a.emitImportQueueLocked()
	}
}

func (a *App) importProcessingLocked() {
	if a.imports.Processing(a.status.ImportID) {
		a.emitImportQueueLocked()
	}
}

func (a *App) ReorderImportQueue(ids []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if err := a.imports.Reorder(ids); err != nil {
		return err
	}
	a.emitImportQueueLocked()
	return nil
}

func (a *App) RemoveImport(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	cancel, err := a.imports.Remove(id)
	if err != nil {
		return err
	}
	if cancel && a.cancel != nil {
		a.cancel()
	}
	a.emitImportQueueLocked()
	return nil
}

func (a *App) RetryImport(id string) error {
	a.mu.Lock()
	if err := a.importAvailableLocked(); err != nil {
		a.mu.Unlock()
		return err
	}
	retry, err := a.imports.Retry(id)
	if err != nil {
		a.mu.Unlock()
		return err
	}
	dir := a.store.Dir
	a.mu.Unlock()
	// Discovery may probe a launcher; keep cancellation and snapshots usable.
	result := retry.Prepare(a.ctx, models.FFmpegPath(dir))
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.importAvailableLocked(); err != nil {
		return err
	}
	queued, err := a.imports.ApplyRetry(retry, result)
	if err != nil {
		return err
	}
	a.emitImportQueueLocked()
	if queued {
		a.pumpImportQueueLocked()
	}
	return nil
}

func (a *App) ClearFinishedImports() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	a.imports.ClearFinished()
	a.emitImportQueueLocked()
	return nil
}
