package app

import (
	"context"
	"errors"

	textmodel "yap/internal/inference/text"
)

// Use the draft endpoint without saving preferences or changing dictation state.
func (a *App) ListTextModels(requestID, endpoint string) ([]string, error) {
	a.mu.Lock()
	if err := a.availableLocked(); err != nil {
		a.mu.Unlock()
		return nil, err
	}
	if !validTextRequestID(requestID) {
		a.mu.Unlock()
		return nil, errors.New("invalid discovery request")
	}
	if a.textRequestCancelledLocked(requestID) {
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
