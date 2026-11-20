package app

import (
	"context"
	"errors"
	"time"

	"yap/internal/app/imports"
	"yap/internal/audio"
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/models"
	"yap/internal/vocabulary"

	"github.com/google/uuid"
)

func (a *App) importAvailableLocked() error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	return speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath, Language: a.settings.Language})
}

func (a *App) ImportAudio() error {
	a.mu.Lock()
	err := a.importAvailableLocked()
	a.mu.Unlock()
	if err != nil {
		return err
	}
	paths, err := a.desktop.Dialog.OpenFile().SetTitle("Import audio files").AddFilter("Audio files", audio.ImportFilePattern).AttachToWindow(a.window).PromptForMultipleSelection()
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

type audioSupportInstaller = imports.Installer
type audioImportSupport struct {
	resolve   imports.Resolver
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
	installApproved := a.imports.InstallApproved()
	if err == nil {
		dir = a.store.Dir
	}
	a.mu.Unlock()
	if err != nil {
		return err
	}
	batch, err := imports.Prepare(a.ctx, paths, models.FFmpegPath(dir), imports.Support{Resolve: support.resolve, Install: support.install, Supported: support.supported})
	if err != nil {
		return err
	}
	if batch.NeedsInstall() && !installApproved {
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
	a.imports.Enqueue(batch)
	a.emitImportQueueLocked()
	a.pumpImportQueueLocked()
	return nil
}

// Called with the state lock held. The queue owns the worker's lifetime.
func (a *App) importAudioWithDecoderLocked(importID string) error {
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
	id, settings, dir := uuid.NewString(), a.settings, a.store.Dir
	ctx, cancel := context.WithCancel(a.ctx)
	work := a.imports.Begin(importID)
	a.latestResult = nil
	a.clearHomeResultLocked()
	a.recordSettings = settings
	a.status.ProfileID = a.profiles.ActiveID()
	a.cancel, a.id, a.path, a.target = cancel, id, path, ""
	a.status.ImportID = importID
	a.indicatorActive = true
	a.status.Phase, a.status.Message, a.status.Transcript = "transcribing", "Decoding…", ""
	a.status.CompletionWarning = false
	a.status.StartedAt, a.status.Progress = time.Now().UnixMilli(), 0
	if work.Downloading() {
		a.status.Phase, a.status.Message = "downloading", "Downloading audio support…"
	}
	a.wg.Add(1)
	a.emitImportQueueLocked()
	a.emitStatusLocked()
	go func() {
		defer a.wg.Done()
		defer cancel()
		var sessionID, transcript string
		importCtx, stop, duration, err := work.Decode(ctx, dir, file, imports.DecodeHooks{
			DownloadProgress: func(n, total int64) {
				a.mu.Lock()
				defer a.mu.Unlock()
				if a.closing || ctx.Err() != nil {
					return
				}
				progress, publish := a.imports.DownloadProgress(importID, n, total, time.Now())
				if total > 0 {
					a.status.Progress = progress / 100
				}
				if publish {
					a.emitImportQueueLocked()
					a.emitStatusLocked()
				}
			},
			Decoding: func() {
				a.mu.Lock()
				defer a.mu.Unlock()
				a.imports.Decoding(importID)
				a.status.Phase, a.status.Message, a.status.Progress = "transcribing", "Decoding…", 0
				a.indicatorActive = true
				a.emitImportQueueLocked()
				a.emitStatusLocked()
			},
		})
		defer stop()
		if err == nil {
			a.mu.Lock()
			a.imports.Transcribing(importID)
			a.status.Message = "Transcribing imported audio…"
			a.emitImportQueueLocked()
			a.emitStatusLocked()
			a.mu.Unlock()
			sessionID, transcript, err = a.transcribe(importCtx, id, path, "", duration, settings, entries, config, false, func(p float64) { a.importProgress(importID, p) })
		} else {
			a.mu.Lock()
			err = errors.Join(err, a.discardAudioLocked(path))
			a.cancel = nil
			if !a.closing {
				if ctx.Err() != nil {
					a.status.Phase, a.status.Message, a.status.StartedAt = "idle", "Audio import cancelled", 0
					a.emitStatusLocked()
				} else {
					a.failLocked(err)
				}
			}
			a.mu.Unlock()
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		a.imports.Finish(importID, sessionID, transcript, a.status.Message, ctx.Err() != nil, err)
		a.cancel = nil
		// Terminal status events already carried this identity. Later hotkey
		// errors must not inherit it and get suppressed as import events.
		a.status.ImportID = ""
		a.emitImportQueueLocked()
		a.pumpQueuesLocked()
	}()
	return nil
}
