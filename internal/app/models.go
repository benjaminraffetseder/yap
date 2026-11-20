package app

import (
	"context"
	"errors"
	"yap/internal/app/modelmanagement"
)

func (a *App) InstallTextModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() || a.textJobID != "" {
		return errors.New("finish the current operation first")
	}
	plan, err := modelmanagement.PrepareText(id)
	if err != nil {
		return err
	}
	a.releaseTextModel()
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	a.cancel = cancel
	a.status.Phase, a.status.Message, a.status.Progress = "downloading", "Checking or downloading text runtime…", 0
	a.emitStatusLocked()
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		defer cancel()
		progress := func(n, total int64) {
			a.mu.Lock()
			defer a.mu.Unlock()
			if ctx.Err() == nil && !a.closing {
				a.status.Progress = float64(n) / float64(total)
				a.emitStatusLocked()
			}
		}
		err := plan.Run(ctx, a.store.Dir, progress, func(message string) {
			a.mu.Lock()
			a.status.Message, a.status.Progress = message, 0
			a.emitStatusLocked()
			a.mu.Unlock()
		})
		a.mu.Lock()
		defer a.mu.Unlock()
		a.cancel = nil
		if a.closing {
			return
		}
		if ctx.Err() != nil {
			a.status.Phase, a.status.Message = "idle", "Download cancelled"
		} else if err != nil {
			a.failLocked(err)
			a.event("setup:changed", []string{"catalogs"})
			return
		} else {
			a.status.Phase, a.status.Message = "idle", "Text model installed. Select it in Prompts to get started."
		}
		a.status.Progress = 0
		a.emitStatusLocked()
		a.event("setup:changed", []string{"catalogs"})
	}()
	return nil
}

func (a *App) RemoveTextModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() || a.textJobID != "" {
		return errors.New("finish the current operation before removing a model")
	}
	if err := modelmanagement.RemoveText(a.store.Dir, id, a.textConfig, a.releaseTextModel); err != nil {
		return err
	}
	a.event("setup:changed", []string{"catalogs"})
	return nil
}

func (a *App) RemoveModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation before removing a model")
	}
	if err := modelmanagement.RemoveSpeech(a.store.Dir, id, a.settings.ModelPath); err != nil {
		return err
	}
	a.event("dictation:history")
	a.event("setup:changed", []string{"catalogs"})
	return nil
}

func (a *App) releaseTextModel() {
	if engine, ok := a.textEngine.(interface{ Release() }); ok {
		engine.Release()
	}
}
