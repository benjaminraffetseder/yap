package main

import (
	"context"
	"errors"
	"strings"
	"time"

	textmodel "yap/internal/inference/text"
)

func (a *App) SaveTextProcessing(config textmodel.Config) (textmodel.Config, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return textmodel.Config{}, err
	}
	if a.busy() || a.textJobID != "" {
		return textmodel.Config{}, errors.New("finish the current operation before changing prompts or the text model")
	}
	normalized, err := textmodel.Normalize(config)
	if err != nil {
		return textmodel.Config{}, err
	}
	if err = a.store.SaveTextProcessing(normalized); err != nil {
		return textmodel.Config{}, err
	}
	a.textConfig = normalized
	a.event("setup:changed")
	return textmodel.Normalize(normalized)
}

// Manual transformations return a preview only. They do not save a recording,
// change a draft, or touch the clipboard. The frontend explicitly applies it.
func (a *App) ProcessText(requestID, input, promptID string) (string, error) {
	return a.processTextRequest(requestID, input, promptID, false)
}

func (a *App) TestTextModel(requestID string) (string, error) {
	return a.processTextRequest(requestID, "Connection test.", "", true)
}

// Use the draft endpoint without saving preferences or changing dictation state.
func (a *App) ListTextModels(requestID, endpoint string) ([]string, error) {
	a.mu.Lock()
	if err := a.available(); err != nil {
		a.mu.Unlock()
		return nil, err
	}
	if requestID == "" || len(requestID) > 80 || strings.ContainsAny(requestID, "\r\n\x00") {
		a.mu.Unlock()
		return nil, errors.New("invalid discovery request")
	}
	a.pruneTextCancellationsLocked()
	if _, cancelled := a.cancelledTextRequests[requestID]; cancelled {
		a.mu.Unlock()
		return nil, context.Canceled
	}
	if len(a.modelDiscoveryCancels) >= 4 || a.modelDiscoveryCancels[requestID] != nil || a.textJobID == requestID {
		a.mu.Unlock()
		return nil, errors.New("model discovery is already running; try again shortly")
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	if a.modelDiscoveryCancels == nil {
		a.modelDiscoveryCancels = map[string]context.CancelFunc{}
	}
	a.modelDiscoveryCancels[requestID] = cancel
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer cancel()
	models, err := textmodel.ListModels(ctx, endpoint)
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.modelDiscoveryCancels, requestID)
	if a.closing || ctx.Err() != nil {
		return nil, context.Canceled
	}
	return models, err
}

func (a *App) processTextRequest(requestID, input, promptID string, test bool) (string, error) {
	a.mu.Lock()
	if err := a.available(); err != nil {
		a.mu.Unlock()
		return "", err
	}
	if requestID == "" || len(requestID) > 80 || strings.ContainsAny(requestID, "\r\n\x00") {
		a.mu.Unlock()
		return "", errors.New("invalid processing request")
	}
	a.pruneTextCancellationsLocked()
	if _, cancelled := a.cancelledTextRequests[requestID]; cancelled {
		a.mu.Unlock()
		return "", context.Canceled
	}
	if a.textJobID != "" || a.busy() {
		a.mu.Unlock()
		return "", errors.New("finish the current operation before processing text")
	}
	config, err := textmodel.Normalize(a.textConfig)
	if err != nil {
		a.mu.Unlock()
		return "", err
	}
	if !config.Enabled {
		a.mu.Unlock()
		return "", errors.New("enable a local text model in Prompts first")
	}
	if err = textmodel.ValidateText(input); err != nil {
		a.mu.Unlock()
		return "", err
	}
	prompt := textmodel.Prompt{Instruction: "Reply with only OK."}
	if !test {
		prompt, err = config.Prompt(promptID)
		if err != nil {
			a.mu.Unlock()
			return "", err
		}
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	a.textJobID, a.textCancel = requestID, cancel
	previous := a.status
	a.status.Phase, a.status.Message = "text-processing", "Processing text…"
	a.emit()
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer cancel()
	output, err := a.textEngine.Process(ctx, config, prompt, input)
	a.mu.Lock()
	defer a.mu.Unlock()
	a.textJobID, a.textCancel = "", nil
	// Restore the dictation display, including any edited latest transcript.
	a.status.Phase, a.status.Message = previous.Phase, previous.Message
	if previous.Phase == "done" && a.id != "" && !a.closing {
		if entry, err := a.store.Session(a.id); err == nil {
			a.status.Transcript = entry.FinalTranscript
		} else {
			a.status.Phase, a.status.Message, a.status.Transcript = "idle", "Ready", ""
		}
	}
	a.emit()
	if a.closing || ctx.Err() != nil {
		return "", context.Canceled
	}
	return output, err
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
