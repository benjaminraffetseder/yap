package main

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"yap/internal/audio"
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/vocabulary"
)

func (a *App) importAvailableLocked() error {
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() || a.textJobID != "" {
		return errors.New("finish the current operation before importing audio")
	}
	return speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath})
}

func (a *App) ImportAudio() error {
	a.mu.Lock()
	err := a.importAvailableLocked()
	a.mu.Unlock()
	if err != nil {
		return err
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Import audio", Filters: []runtime.FileFilter{{DisplayName: "Audio files", Pattern: audio.ImportFilePattern}}})
	if err != nil || path == "" {
		return err
	}
	return a.importAudio(path)
}

func (a *App) importAudio(source string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.importAvailableLocked(); err != nil {
		return err
	}
	config, err := textmodel.Normalize(a.textConfig)
	if err != nil {
		return err
	}
	entries, err := vocabulary.Normalize(a.vocabulary)
	if err != nil {
		return err
	}
	file, path, err := a.store.CreateRecording()
	if err != nil {
		return err
	}
	id, settings := uuid.NewString(), a.settings
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Minute)
	a.cancel, a.id, a.path, a.target = cancel, id, path, ""
	a.indicatorActive = true
	a.status.Phase, a.status.Message, a.status.Transcript = "transcribing", "Importing audio…", ""
	a.status.StartedAt, a.status.Progress = time.Now().UnixMilli(), 0
	a.wg.Add(1)
	a.emit()
	go func() {
		defer a.wg.Done()
		defer cancel()
		duration, err := audio.NormalizeImport(ctx, source, file)
		err = errors.Join(err, file.Close())
		a.mu.Lock()
		if a.closing || ctx.Err() != nil || err != nil {
			err = errors.Join(err, a.discardAudioLocked(path))
			a.cancel = nil
			if !a.closing {
				if ctx.Err() != nil {
					a.status.Phase, a.status.Message, a.status.StartedAt = "idle", "Audio import cancelled", 0
					a.emit()
				} else {
					a.fail(err)
				}
			}
			a.mu.Unlock()
			return
		}
		a.status.Message = "Transcribing imported audio…"
		a.emit()
		a.mu.Unlock()
		a.transcribe(ctx, id, path, "", duration, settings, entries, config, false)
	}()
	return nil
}
