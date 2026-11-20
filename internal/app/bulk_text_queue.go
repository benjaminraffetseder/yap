package app

import (
	"yap/internal/app/bulktext"
	"yap/internal/app/textprocessing"
)

type BulkTextRequest = bulktext.BulkTextRequest
type BulkTextJob = bulktext.BulkTextJob

func (a *App) QueueBulkText(request BulkTextRequest) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return 0, err
	}
	count, err := a.bulkText.Enqueue(a.store, a.textConfig, request)
	if err != nil {
		return 0, err
	}
	a.emitBulkTextQueueLocked()
	a.pumpBulkTextQueueLocked()
	return count, nil
}

func (a *App) bulkTextSnapshotLocked() []BulkTextJob { return a.bulkText.Snapshot() }

func (a *App) emitBulkTextQueueLocked() {
	if !a.closing {
		a.event("text:queue", a.bulkTextSnapshotLocked())
	}
}

func (a *App) pumpBulkTextQueueLocked() {
	if a.closing || a.busyLocked() || a.textJobID != "" || a.imports.Pending() {
		return
	}
	if a.bulkText.Schedule() {
		a.wg.Add(1)
		go a.startNextBulkText()
	}
}

func (a *App) startNextBulkText() {
	defer a.wg.Done()
	a.mu.Lock()
	a.bulkText.ResetPending()
	if a.closing || a.busyLocked() || a.textJobID != "" || a.bulkText.ActiveID() != "" || a.imports.Pending() {
		a.mu.Unlock()
		return
	}
	next := a.bulkText.Next()
	if next == nil {
		a.mu.Unlock()
		return
	}
	a.emitBulkTextQueueLocked()
	request := textRequest{
		Request: textprocessing.Request{
			Config: next.Config, PromptID: next.PromptID, TitleSessionID: next.TitleSessionID,
		},
		saveTitle: next.SaveTitle, expectedTitle: next.ExpectedTitle,
	}
	if next.OutputSessionID != "" {
		request.Target = &textprocessing.OutputTarget{SessionID: next.OutputSessionID}
	}
	_, err := a.processTextRequestLocked(next.ID, request)
	a.mu.Lock()
	defer a.mu.Unlock()
	a.bulkText.Finish(next.ID, a.closing, err)
	a.emitBulkTextQueueLocked()
	a.emitStatusLocked()
}

// Completed chain steps and earlier jobs remain saved after cancellation.
func (a *App) CancelBulkTextQueue() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if id := a.bulkText.Cancel(); id != "" && a.textJobID == id && a.textCancel != nil {
		a.textCancel()
	}
	a.emitBulkTextQueueLocked()
}

func (a *App) ClearFinishedBulkTextJobs() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.bulkText.ClearFinished()
	a.emitBulkTextQueueLocked()
}
