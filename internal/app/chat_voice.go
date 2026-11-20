package app

import (
	"context"
	"errors"
	"time"

	"yap/internal/app/recording"
)

type chatVoiceCapture = recording.VoiceCapture
type ChatVoiceProgress = recording.VoiceProgress

// Chat speech shares operation arbitration, but its feature retains only a
// draft: it never creates History, changes Home, or delivers to the clipboard.
func (a *App) StartChatVoice(requestID, sessionID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	if err := recording.ValidateVoiceRequest(requestID); err != nil {
		return err
	}
	if a.textRequestCancelledLocked(requestID) {
		return context.Canceled
	}
	if a.busyLocked() || a.textJobID != "" {
		return errors.New("finish the current operation before recording a chat message")
	}
	if _, err := a.store.Session(sessionID); err != nil {
		return err
	}
	capture, err := recording.Prepare(a.settings, a.textConfig, a.vocabulary, a.store.CreateRecording, a.discardAudioLocked)
	if err != nil {
		return err
	}
	if err := capture.Start(a.recorder, a.settings.MicrophoneID, func(float64) {}, a.discardAudioLocked); err != nil {
		return err
	}
	voice := recording.NewVoice(requestID, sessionID, capture)
	a.chatVoice = voice
	ctx, cancel, previous, savedText := a.beginTextJobLocked(requestID)
	a.status.Message = "Recording chat message…"
	a.emitStatusLocked()
	go func() {
		defer a.wg.Done()
		defer cancel()
		ctx, timeout := context.WithTimeout(ctx, 5*time.Minute)
		defer timeout()
		timer := time.NewTimer(2 * time.Minute)
		defer timer.Stop()
		select {
		case <-voice.StopSignal():
		case <-timer.C:
		case <-ctx.Done():
		}
		a.mu.Lock()
		err := voice.StopCapture(ctx, a.recorder)
		if err == nil && !a.closing {
			a.status.Message = "Transcribing chat message…"
			a.emitStatusLocked()
			a.event("chat:voice", voice.Progress("transcribing"))
		}
		a.mu.Unlock()
		var text string
		if err == nil {
			text, err = voice.Recognize(ctx, a.engine)
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		err = voice.Finalize(ctx, err, func() error {
			_, entryErr := a.store.Session(sessionID)
			return entryErr
		}, func() error { return a.discardAudioLocked(voice.Path()) })
		voice.Finish(text, err, func(progress recording.VoiceProgress) {
			a.finishTextJobLocked(previous, savedText)
			if !a.closing {
				a.event("chat:voice", progress)
			}
		})
	}()
	return nil
}

func (a *App) StopChatVoice(requestID string) (string, error) {
	a.mu.Lock()
	voice := a.chatVoice
	if voice == nil || voice.ID() != requestID {
		a.mu.Unlock()
		return "", errors.New("this chat recording is no longer active")
	}
	voice.Stop()
	a.mu.Unlock()
	<-voice.Done()
	return voice.Result()
}
