package app

import (
	"context"
	"errors"
	"time"
	"yap/internal/app/recording"
	"yap/internal/audio"
	textmodel "yap/internal/inference/text"
	"yap/internal/platform"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

type TemporaryResult = recording.TemporaryResult

func (a *App) GetMicrophones() ([]audio.Device, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return nil, err
	}
	return a.microphones()
}

func (a *App) StartRecording() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	err := a.startRecordingLocked(false)
	if err != nil && a.indicatorActive && !a.busyLocked() {
		a.failLocked(err)
	}
	return err
}
func (a *App) startRecordingLocked(external bool) error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() {
		return errors.New("finish the current operation first")
	}
	a.indicatorActive = true
	settings, textConfig, profileID, err := a.recordingConfiguration(external)
	if err != nil {
		return err
	}
	capture, err := recording.Prepare(settings, textConfig, a.vocabulary, a.store.CreateRecording, a.discardAudioLocked)
	if err != nil {
		return err
	}
	a.id, a.path = capture.ID, capture.Path
	a.target = ""
	if recording.CapturePasteTarget(external, a.settings) {
		a.target = platform.Target()
	}
	if err := capture.Start(a.recorder, a.settings.MicrophoneID, func(level float64) {
		a.event("dictation:level", level)
		if a.indicator != nil {
			a.indicator.SetLevel(level)
		}
	}, a.discardAudioLocked); err != nil {
		return err
	}
	a.latestResult = nil
	a.clearHomeResultLocked()
	a.recordSettings = settings
	a.recordTextConfig = capture.TextConfig
	a.status.ProfileID = profileID
	a.recordVocabulary = capture.Vocabulary
	a.status.ImportID = ""
	a.status.Phase = "recording"
	a.status.CompletionWarning = false
	a.status.Message = "Listening…"
	a.status.Transcript = ""
	a.status.StartedAt = time.Now().UnixMilli()
	if external {
		a.profiles.ClearOverride()
	}
	a.status.Progress = 0
	a.emitStatusLocked()
	id := a.id
	a.timer = time.AfterFunc(10*time.Minute, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if !a.closing && a.id == id && a.status.Phase == "recording" {
			a.stopRecordingLocked()
		}
	})
	return nil
}
func (a *App) StopRecording() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.status.Phase != "recording" {
		return errors.New("no recording in progress")
	}
	a.stopRecordingLocked()
	return nil
}

func (a *App) indicatorStop(sessionID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing || sessionID == "" || a.id != sessionID || a.status.Phase != "recording" {
		return
	}
	a.stopRecordingLocked()
}

func (a *App) indicatorCancel(sessionID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing || sessionID == "" || a.id != sessionID || a.status.Phase != "recording" && a.status.Phase != "transcribing" {
		return
	}
	_ = a.cancelLocked()
}
func (a *App) stopRecordingLocked() {
	if a.timer != nil {
		a.timer.Stop()
	}
	duration, err := recording.Stop(a.recorder)
	if err != nil {
		a.failLocked(errors.Join(err, a.discardAudioLocked(a.path)))
		return
	}
	a.status.Phase = "transcribing"
	a.status.Message = "Transcribing on your device…"
	a.emitStatusLocked()
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Minute)
	a.cancel = cancel
	id, path, target, settings := a.id, a.path, a.target, a.recordSettings
	textConfig := a.recordTextConfig
	entries := a.recordVocabulary
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		defer cancel()
		a.transcribe(ctx, id, path, target, duration, settings, entries, textConfig, settings.AutoCopy, nil)
	}()
}
func (a *App) transcribe(ctx context.Context, id, path, target string, duration int64, settings storage.Settings, entries []vocabulary.Entry, textConfig textmodel.Config, copyToClipboard bool, onProgress func(float64)) (sessionID, transcript string, resultErr error) {
	var result *recording.Completion
	recognized, err := recording.Recognize(ctx, a.engine, path, settings, entries, onProgress)
	a.mu.Lock()
	a.status.CompletionWarning = false
	defer a.mu.Unlock()
	defer func() {
		a.cancel = nil
		if result == nil || result.DiscardAudio() {
			_ = a.discardAudioLocked(path)
		}
	}()
	if a.closing {
		return "", "", context.Canceled
	}
	if ctx.Err() != nil {
		a.status.Phase = "idle"
		a.status.Message = "Transcription cancelled"
		a.status.StartedAt = 0
		a.emitStatusLocked()
		return "", "", ctx.Err()
	}
	if err != nil {
		a.failLocked(err)
		return "", "", err
	}
	result = recording.NewCompletion(id, path, duration, recognized, settings, entries, a.status.ImportID != "")
	a.homeResult = result.Home
	if err := result.Save(a.store.Add); err != nil {
		a.latestResult = result.Temporary
		a.applyRecordingOutcomeLocked(result.HistoryFailure())
		a.emitStatusLocked()
		a.event("dictation:history")
		return "", result.Home.Text, err
	}
	if result.Temporary != nil {
		a.latestResult = result.Temporary
	}
	session := result.Home.Session
	if result.Home.Saved {
		a.pruneHistoryLocked()
		// Title inference follows automatic processing and delivery, on the
		// shared text queue so imports and model requests remain serialized.
		defer func() {
			if result.GenerateTitle(textConfig) && !a.closing && ctx.Err() == nil {
				a.bulkText.EnqueueTitle(session, textConfig)
				a.emitBulkTextQueueLocked()
				if a.imports.ActiveID() == "" {
					a.pumpBulkTextQueueLocked()
				}
			}
		}()
	}
	sessionID, transcript = result.SessionID(), result.Home.Text
	recipe, automatic, promptErr := result.AutomaticRecipe(textConfig)
	if automatic {
		a.status.Message = "Processing text…"
		a.importProcessingLocked()
		a.emitStatusLocked()
		a.event("dictation:history")
		// The speech result is durable. Per-step commits use the existing
		// cancellation-checked recipe hook while inference runs unlocked.
		a.mu.Unlock()
		var processed string
		if promptErr == nil {
			processed, promptErr = a.runTextRecipe(ctx, textConfig, recipe, session, func(output storage.GeneratedOutput) error {
				return result.CommitOutput(output, a.store.AddGeneratedOutput)
			})
		}
		a.mu.Lock()
		if a.closing {
			return
		}
		outcome, complete := result.FinishProcessing(ctx.Err(), processed, promptErr)
		if !complete {
			a.applyRecordingOutcomeLocked(outcome)
			a.emitStatusLocked()
			return
		}
	}
	delivery := recording.Delivery{}
	a.status.Message = result.FinishDelivery(delivery, target, ctx.Err()).Message
	if copyToClipboard {
		copy, copyContext := a.copyText, a.copyTextContext
		text := result.Home.Text
		a.mu.Unlock()
		delivery = recording.Deliver(ctx, text, target, copy, copyContext, platform.Paste)
		a.mu.Lock()
		if a.closing {
			return
		}
	}
	a.applyRecordingOutcomeLocked(result.FinishDelivery(delivery, target, ctx.Err()))
	transcript = result.Home.Text
	a.emitStatusLocked()
	a.event("dictation:history")
	return
}

func (a *App) applyRecordingOutcomeLocked(outcome recording.Outcome) {
	a.status.Phase, a.status.Message, a.status.Transcript, a.status.StartedAt = "done", outcome.Message, outcome.Transcript, 0
	a.status.CompletionWarning = outcome.Warning
}

func (a *App) Cancel() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cancelLocked()
}

func (a *App) cancelLocked() error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.shortcuts.Registering() {
		a.shortcuts.CancelRegistration()
		return nil
	}
	if a.status.Phase == "mic-test" || a.status.Phase == "diagnostic-recording" {
		diagnostic := a.status.Phase == "diagnostic-recording"
		if a.timer != nil {
			a.timer.Stop()
		}
		_, err := a.recorder.Stop()
		err = errors.Join(err, a.discardAudioLocked(a.path))
		a.microphoneTested = false
		a.status.Phase, a.status.Message = "idle", "Microphone test cancelled"
		a.status.StartedAt = 0
		if diagnostic {
			a.diagnostic = DiagnosticResult{Phase: "cancelled", Message: "Test cancelled"}
			a.status.Message = a.diagnostic.Message
		}
		a.emitStatusLocked()
		a.event("setup:changed")
		return err
	}
	if a.status.Phase == "recording" {
		a.timer.Stop()
		_, stopErr := a.recorder.Stop()
		err := errors.Join(stopErr, a.discardAudioLocked(a.path))
		a.status.Phase = "idle"
		a.status.Message = "Recording discarded"
		a.status.StartedAt = 0
		a.emitStatusLocked()
		return err
	} else if a.textCancel != nil && a.status.Phase == "text-processing" {
		a.textCancel()
	} else if a.cancel != nil {
		a.cancel()
		a.status.Message = "Cancelling…"
		a.emitStatusLocked()
	}
	return nil
}
