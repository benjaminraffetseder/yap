package app

import (
	"context"
	"errors"
	"yap/internal/app/modelmanagement"
)

func (a *App) SelectFile(kind string) (string, error) {
	label, pattern, err := modelmanagement.FileSelection(kind)
	if err != nil {
		return "", err
	}
	return a.openFile("Select "+label, label, pattern)
}
func (a *App) InstallModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation first")
	}
	plan, err := modelmanagement.PrepareSpeech(id)
	if err != nil {
		return err
	}
	a.status.Phase = "downloading"
	a.status.Message = "Checking or downloading speech runtime…"
	a.status.Progress = 0
	a.emitStatusLocked()
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancel = cancel
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		defer cancel()
		progress := func(n, total int64) {
			a.mu.Lock()
			defer a.mu.Unlock()
			a.status.Progress = float64(n) / float64(total)
			a.emitStatusLocked()
		}
		a.mu.Lock()
		executable := a.settings.WhisperPath
		a.mu.Unlock()
		result, err := plan.Run(ctx, a.store.Dir, executable, progress, func(message string) {
			a.mu.Lock()
			a.status.Message = message
			a.status.Progress = 0
			a.emitStatusLocked()
			a.mu.Unlock()
		})
		a.mu.Lock()
		defer a.mu.Unlock()
		a.cancel = nil
		if a.closing {
			return
		}
		defer a.event("setup:changed", []string{"configuration", "catalogs"})
		if ctx.Err() != nil {
			a.status.Phase = "idle"
			a.status.Message = "Download cancelled"
			a.emitStatusLocked()
			return
		}
		if err != nil {
			a.failLocked(err)
			return
		}
		settings := result.Settings(a.settings)
		if err = a.saveSettingsWithDefaultLocked(settings); err != nil {
			a.failLocked(err)
			return
		}
		a.settings = settings
		a.diagnostic = DiagnosticResult{}
		a.status.Phase = "idle"
		a.status.Message = "Model installed. Ready to dictate."
		a.status.Progress = 0
		a.emitStatusLocked()
		a.event("dictation:history")
	}()
	return nil
}
