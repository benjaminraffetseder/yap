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
	"yap/internal/models"
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
	return a.prepareAudioImport(path, audioImportSupport{
		resolve: audio.ImportDecoder, supported: models.CanInstallFFmpeg(), install: models.InstallFFmpeg,
		confirm: func() (bool, error) {
			return a.confirmAudioSupportDownload("The selected import will continue when ready.")
		},
	})
}

type audioSupportInstaller func(context.Context, string, func(int64, int64)) (string, error)
type audioImportSupport struct {
	resolve   func(context.Context, string, string) (string, error)
	confirm   func() (bool, error)
	install   audioSupportInstaller
	supported bool
}

func (a *App) prepareAudioImport(source string, support audioImportSupport) error {
	a.mu.Lock()
	err := a.importAvailableLocked()
	var dir string
	if err == nil {
		dir = a.store.Dir
	}
	a.mu.Unlock()
	if err != nil {
		return err
	}
	decoder, err := support.resolve(a.ctx, source, models.FFmpegPath(dir))
	var install audioSupportInstaller
	if errors.Is(err, audio.ErrFFmpegMissing) && support.supported {
		confirmed, confirmErr := support.confirm()
		if confirmErr != nil || !confirmed {
			return confirmErr
		}
		install, err = support.install, nil
	}
	if err != nil {
		return err
	}
	// Recheck availability after the native dialogs: another operation may have
	// started, or shutdown may have begun, while the user was deciding.
	return a.importAudioWithDecoder(source, decoder, install)
}

func (a *App) importAudio(source string) error {
	return a.importAudioWithDecoder(source, "", nil)
}

func (a *App) importAudioWithDecoder(source, decoder string, install audioSupportInstaller) error {
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
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancel, a.id, a.path, a.target = cancel, id, path, ""
	a.indicatorActive = true
	a.status.Phase, a.status.Message, a.status.Transcript = "transcribing", "Importing audio…", ""
	a.status.StartedAt, a.status.Progress = time.Now().UnixMilli(), 0
	if install != nil {
		a.status.Phase, a.status.Message = "downloading", "Downloading audio support…"
	}
	a.wg.Add(1)
	a.emit()
	go func() {
		defer a.wg.Done()
		defer cancel()
		var err error
		if install != nil {
			downloadCtx, stopDownload := context.WithTimeout(ctx, 30*time.Minute)
			decoder, err = install(downloadCtx, a.store.Dir, func(n, total int64) {
				a.mu.Lock()
				defer a.mu.Unlock()
				if a.closing || ctx.Err() != nil {
					return
				}
				if total > 0 {
					a.status.Progress = min(1, float64(n)/float64(total))
				}
				if n == total {
					a.status.Message = "Installing audio support…"
				}
				a.emit()
			})
			stopDownload()
		}
		if err == nil {
			err = ctx.Err()
		}
		var duration int64
		// Give decoding/transcription its own budget after the download, while
		// retaining the same cancellation handle and busy state throughout.
		importCtx, stopImport := context.WithTimeout(ctx, 15*time.Minute)
		defer stopImport()
		if err == nil {
			a.mu.Lock()
			err = ctx.Err()
			if err == nil && !a.closing {
				a.indicatorActive = true
				a.status.Phase, a.status.Message, a.status.Progress = "transcribing", "Importing audio…", 0
				a.emit()
			}
			a.mu.Unlock()
			if decoder == "" {
				decoder = models.FFmpegPath(a.store.Dir)
			}
			if err == nil {
				duration, err = audio.NormalizeImportWithFFmpeg(importCtx, source, file, decoder)
			}
		}
		err = errors.Join(err, file.Close())
		a.mu.Lock()
		if a.closing || ctx.Err() != nil || err != nil {
			err = errors.Join(err, a.discardAudioLocked(path))
			a.cancel = nil
			a.status.Progress = 0
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
		a.transcribe(importCtx, id, path, "", duration, settings, entries, config, false)
	}()
	return nil
}
