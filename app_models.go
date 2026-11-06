package main

import (
	"context"
	"errors"
	"yap/internal/models"
)

func (a *App) InstallTextModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() || a.textJobID != "" {
		return errors.New("finish the current operation first")
	}
	if _, ok := models.FindTextModel(id); !ok {
		return errors.New("unknown text model")
	}
	if !models.TextRuntimeAvailable() {
		return errors.New("built-in text models currently require Windows x64")
	}
	if engine, ok := a.textEngine.(interface{ Release() }); ok {
		engine.Release()
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	a.cancel = cancel
	a.status.Phase, a.status.Message, a.status.Progress = "downloading", "Checking or downloading text runtime…", 0
	a.emit()
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		defer cancel()
		progress := func(n, total int64) {
			a.mu.Lock()
			defer a.mu.Unlock()
			if ctx.Err() == nil && !a.closing {
				a.status.Progress = float64(n) / float64(total)
				a.emit()
			}
		}
		err := models.EnsureTextRuntime(ctx, a.store.Dir, progress)
		if err == nil {
			a.mu.Lock()
			a.status.Message, a.status.Progress = "Checking or downloading "+id+"…", 0
			a.emit()
			a.mu.Unlock()
			err = models.InstallTextModel(ctx, a.store.Dir, id, progress)
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		a.cancel = nil
		if a.closing {
			return
		}
		if ctx.Err() != nil {
			a.status.Phase, a.status.Message = "idle", "Download cancelled"
		} else if err != nil {
			a.fail(err)
			a.event("setup:changed")
			return
		} else {
			a.status.Phase, a.status.Message = "idle", "Text model installed. Select it in Prompts to get started."
		}
		a.status.Progress = 0
		a.emit()
		a.event("setup:changed")
	}()
	return nil
}

func (a *App) RemoveTextModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() || a.textJobID != "" {
		return errors.New("finish the current operation before removing a model")
	}
	if a.textConfig.Provider == "builtin" && a.textConfig.Model == id {
		return errors.New("select another text model or an external server before removing this model")
	}
	if engine, ok := a.textEngine.(interface{ Release() }); ok {
		engine.Release()
	}
	if err := models.RemoveTextModel(a.store.Dir, id); err != nil {
		return err
	}
	a.event("setup:changed")
	return nil
}

func (a *App) RemoveModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation before removing a model")
	}
	if err := models.Remove(a.store.Dir, id, a.settings.ModelPath); err != nil {
		return err
	}
	a.event("dictation:history")
	return nil
}
