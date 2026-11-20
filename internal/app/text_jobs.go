package app

import (
	"context"
	"strings"
	"time"
)

// Reserve the shared text engine and register the caller with shutdown before
// releasing mu. The caller must cancel the context and finish its wg entry.
func (a *App) beginTextJobLocked(requestID string) (context.Context, context.CancelFunc, Status, string) {
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	a.textJobID, a.textCancel = requestID, cancel
	previous, savedText := a.status, ""
	if previous.Phase == "done" && a.id != "" {
		if entry, err := a.store.Session(a.id); err == nil {
			savedText = entry.FinalTranscript
		}
	}
	a.status.Phase, a.status.Message = "text-processing", "Processing text…"
	a.wg.Add(1)
	a.emitStatusLocked()
	return ctx, cancel, previous, savedText
}

func (a *App) finishTextJobLocked(previous Status, savedText string) {
	a.textJobID, a.textCancel = "", nil
	// Restore only the text job's presentation. Native integration errors may
	// have changed during inference and must survive completion.
	a.status.Phase, a.status.Message, a.status.Transcript = previous.Phase, previous.Message, previous.Transcript
	if previous.Phase == "done" && a.id != "" && !a.closing {
		if entry, err := a.store.Session(a.id); err == nil {
			if entry.FinalTranscript != savedText {
				a.status.Transcript, a.status.Message = entry.FinalTranscript, "Transcript updated in History"
			}
		} else {
			a.status.Phase, a.status.Message, a.status.Transcript = "idle", "Ready", ""
		}
	}
	a.emitStatusLocked()
}

func (a *App) CancelTextProcessing(requestID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if requestID == "" || len(requestID) > 80 {
		return
	}
	// Remember an early cancellation if the bridge schedules it before the
	// processing call. A stale cancellation never cancels a different job.
	a.pruneTextCancellationsLocked()
	if a.cancelledTextRequests == nil {
		a.cancelledTextRequests = map[string]time.Time{}
	}
	if len(a.cancelledTextRequests) >= 128 {
		var oldest string
		for id, when := range a.cancelledTextRequests {
			if oldest == "" || when.Before(a.cancelledTextRequests[oldest]) {
				oldest = id
			}
		}
		delete(a.cancelledTextRequests, oldest)
	}
	a.cancelledTextRequests[requestID] = time.Now()
	if a.textJobID == requestID && a.textCancel != nil {
		a.textCancel()
	}
	if cancel := a.modelDiscoveryCancels[requestID]; cancel != nil {
		cancel()
	}
}

func (a *App) pruneTextCancellationsLocked() {
	cutoff := time.Now().Add(-10 * time.Minute)
	for id, when := range a.cancelledTextRequests {
		if when.Before(cutoff) {
			delete(a.cancelledTextRequests, id)
		}
	}
}

func validTextRequestID(requestID string) bool {
	return requestID != "" && len(requestID) <= 80 && !strings.ContainsAny(requestID, "\r\n\x00")
}

func (a *App) textRequestCancelledLocked(requestID string) bool {
	a.pruneTextCancellationsLocked()
	_, cancelled := a.cancelledTextRequests[requestID]
	return cancelled
}
