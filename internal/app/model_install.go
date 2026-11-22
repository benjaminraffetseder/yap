package app

import (
	"context"
	"errors"
	"yap/internal/app/modelmanagement"
	"yap/internal/models"
)

func (a *App) SelectFile(kind string) (string, error) {
	label, pattern, err := modelmanagement.FileSelection(kind)
	if err != nil {
		return "", err
	}
	return a.openFile("Select "+label, label, pattern)
}
func (a *App) InstallModel(id string) error {
	return a.installSpeechModel(id, false)
}

func (a *App) UpdateModelRuntime(id string) error {
	return a.installSpeechModel(id, true)
}

func (a *App) installSpeechModel(id string, runtimeOnly bool) error {
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
	if err := a.releaseSpeechModelLocked(); err != nil {
		return err
	}
	a.status.Phase = "downloading"
	a.status.Message = "Checking or downloading speech runtime…"
	if runtimeOnly {
		a.status.Message = "Updating speech runtime…"
	}
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
		stage := func(message string) {
			a.mu.Lock()
			a.status.Message = message
			a.status.Progress = 0
			a.emitStatusLocked()
			a.mu.Unlock()
		}
		var result modelmanagement.SpeechResult
		var err error
		if runtimeOnly {
			err = plan.UpdateRuntime(ctx, a.store.Dir, progress, func(path string) error {
				a.mu.Lock()
				defer a.mu.Unlock()
				if err := ctx.Err(); err != nil {
					return err
				}
				if a.settings.WhisperPath != "" && !models.IsManagedRuntime(a.store.Dir, a.settings.WhisperPath) {
					linked, err := models.ReferencesSupersededRuntime(a.store.Dir, a.settings.WhisperPath, "whisper")
					if err != nil {
						return err
					}
					if linked {
						return errors.New("your custom Whisper selection points into the old Yap runtime; choose a separate executable in Settings before updating; the old runtime has been kept")
					}
					return nil
				}
				settings := a.settings
				settings.WhisperPath = path
				if err := a.saveSettingsWithDefaultLocked(settings); err != nil {
					return err
				}
				a.settings = settings
				return nil
			})
		} else {
			result, err = plan.Run(ctx, a.store.Dir, executable, progress, stage)
		}
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
		if !runtimeOnly {
			settings := result.Settings(a.settings)
			if err = a.saveSettingsWithDefaultLocked(settings); err != nil {
				a.failLocked(err)
				return
			}
			a.settings = settings
		}
		a.diagnostic = DiagnosticResult{}
		a.status.Phase = "idle"
		a.status.Message = "Model installed. Ready to dictate."
		if runtimeOnly {
			a.status.Message = "Speech runtime updated."
		}
		a.status.Progress = 0
		a.emitStatusLocked()
		a.event("dictation:history")
	}()
	return nil
}
