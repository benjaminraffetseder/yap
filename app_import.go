package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"time"

	"yap/internal/audio"
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/models"
	"yap/internal/vocabulary"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) importAvailableLocked() error {
	if err := a.available(); err != nil {
		return err
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
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{Title: "Import audio files", Filters: []runtime.FileFilter{{DisplayName: "Audio files", Pattern: audio.ImportFilePattern}}})
	if err != nil || len(paths) == 0 {
		return err
	}
	return a.ImportDroppedAudio(paths)
}

func (a *App) ImportDroppedAudio(paths []string) error {
	return a.prepareAudioImports(paths, audioImportSupport{
		resolve: audio.ImportDecoder, supported: models.CanInstallFFmpeg(), install: models.InstallFFmpeg,
		confirm: func() (bool, error) {
			return a.confirmAudioSupportDownload("The queued imports will continue when ready.")
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
	return a.prepareAudioImports([]string{source}, support)
}

func (a *App) importAudio(source string) error { return a.ImportDroppedAudio([]string{source}) }

func (a *App) prepareAudioImports(paths []string, support audioImportSupport) error {
	if len(paths) == 0 {
		return errors.New("choose at least one audio file")
	}
	a.mu.Lock()
	err := a.importAvailableLocked()
	var dir string
	installApproved := a.importInstallAudioSupport
	if err == nil {
		dir = a.store.Dir
	}
	a.mu.Unlock()
	if err != nil {
		return err
	}
	jobs := make([]*importJob, 0, len(paths))
	needsInstall := false
	for _, source := range paths {
		job := &importJob{ImportJob: ImportJob{ID: uuid.NewString(), Name: filepath.Base(source), State: "queued", Message: "Queued", Progress: -1}, source: source, resolve: support.resolve}
		var validationErr error
		if strings.TrimSpace(source) == "" {
			validationErr = errors.New("choose an audio file")
		} else {
			job.decoder, validationErr = support.resolve(a.ctx, source, models.FFmpegPath(dir))
		}
		if errors.Is(validationErr, audio.ErrFFmpegMissing) && support.supported {
			needsInstall, validationErr = true, nil
			// Keep batch approval available to every dependent job's explicit retry.
			job.installer = support.install
		}
		if validationErr != nil {
			job.State, job.Message, job.Error = "failed", importError(source, validationErr), importError(source, validationErr)
		}
		jobs = append(jobs, job)
	}
	if needsInstall && !installApproved {
		confirmed, err := support.confirm()
		if err != nil || !confirmed {
			return err
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.importAvailableLocked(); err != nil {
		return err
	}
	if needsInstall && !a.importInstallAudioSupport {
		a.importInstallAudioSupport, a.importInstaller = true, support.install
	}
	a.importQueue = append(a.importQueue, jobs...)
	a.emitImportQueueLocked()
	a.pumpImportQueueLocked()
	return nil
}

// Called with the state lock held. The queue owns the worker's lifetime.
func (a *App) importAudioWithDecoder(job *importJob) error {
	config, err := textmodel.Normalize(a.textConfig)
	if err != nil {
		return err
	}
	entries, err := vocabulary.Normalize(a.vocabulary)
	if err != nil {
		return err
	}
	if err := a.importAvailableLocked(); err != nil {
		return err
	}
	file, path, err := a.store.CreateRecording()
	if err != nil {
		return err
	}
	id, settings := uuid.NewString(), a.settings
	ctx, cancel := context.WithCancel(a.ctx)
	decoder, install := job.decoder, a.importInstaller
	if a.importInstallAudioSupport {
		a.importInstallAudioSupport, a.importInstaller = false, nil
		job.installer = install
	} else {
		install = nil
	}
	a.latestResult = nil
	a.recordSettings = settings
	a.status.ProfileID = a.profileLibrary.ActiveID
	a.cancel, a.id, a.path, a.target = cancel, id, path, ""
	a.status.ImportID = job.ID
	a.indicatorActive = true
	a.status.Phase, a.status.Message, a.status.Transcript = "transcribing", "Decoding…", ""
	a.status.CompletionWarning = false
	a.status.StartedAt, a.status.Progress = time.Now().UnixMilli(), 0
	if install != nil {
		a.status.Phase, a.status.Message = "downloading", "Downloading audio support…"
		job.Message = a.status.Message
	}
	a.wg.Add(1)
	a.emitImportQueueLocked()
	a.emit()
	go func() {
		defer a.wg.Done()
		defer cancel()
		var sessionID, transcript string
		var err error
		if install != nil {
			downloadCtx, stop := context.WithTimeout(ctx, 30*time.Minute)
			decoder, err = install(downloadCtx, a.store.Dir, func(n, total int64) {
				a.mu.Lock()
				defer a.mu.Unlock()
				if a.closing || ctx.Err() != nil {
					return
				}
				if total > 0 {
					job.Progress = min(100, float64(n)*100/float64(total))
					a.status.Progress = job.Progress / 100
				}
				if n == total {
					job.Message = "Installing audio support…"
				}
				if time.Since(job.lastProgress) >= 250*time.Millisecond || n == total {
					job.lastProgress = time.Now()
					a.emitImportQueueLocked()
					a.emit()
				}
			})
			stop()
		}
		importCtx, stop := context.WithTimeout(ctx, 15*time.Minute)
		defer stop()
		var duration int64
		if err == nil {
			err = importCtx.Err()
		}
		if err == nil {
			a.mu.Lock()
			job.Message, job.Progress = "Decoding…", -1
			a.status.Phase, a.status.Message, a.status.Progress = "transcribing", job.Message, 0
			a.indicatorActive = true
			a.emitImportQueueLocked()
			a.emit()
			a.mu.Unlock()
			if decoder == "" {
				decoder = models.FFmpegPath(a.store.Dir)
			}
			duration, err = audio.NormalizeImportWithFFmpeg(importCtx, job.source, file, decoder)
		}
		err = errors.Join(err, file.Close())
		if err == nil {
			a.mu.Lock()
			job.State, job.Message, job.Progress = "transcribing", "Transcribing…", -1
			job.lastProgress = time.Time{}
			a.status.Message = "Transcribing imported audio…"
			a.emitImportQueueLocked()
			a.emit()
			a.mu.Unlock()
			sessionID, transcript, err = a.transcribe(importCtx, id, path, "", duration, settings, entries, config, false, func(p float64) { a.importProgress(job, p) })
		} else {
			a.mu.Lock()
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
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		job.SessionID, job.Transcript = sessionID, transcript
		switch {
		case transcript != "":
			job.State, job.Message, job.Progress = "done", a.status.Message, 100
		case ctx.Err() != nil || errors.Is(err, context.Canceled):
			job.State, job.Message, job.Progress = "cancelled", "Cancelled", -1
		case err != nil:
			job.State, job.Message, job.Error, job.Progress = "failed", importError(job.source, err), importError(job.source, err), -1
		default:
			job.State, job.Message, job.Progress = "cancelled", "Cancelled", -1
		}
		a.importActive, a.cancel = "", nil
		// Terminal status events have already carried this job's identity. Do not
		// let a later hotkey error inherit it and get suppressed as an import.
		a.status.ImportID = ""
		a.emitImportQueueLocked()
		a.pumpImportQueueLocked()
	}()
	return nil
}

func importError(source string, err error) string {
	if source == "" {
		return err.Error()
	}
	return strings.ReplaceAll(err.Error(), source, filepath.Base(source))
}
