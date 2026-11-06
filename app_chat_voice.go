package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"yap/internal/inference/speech"
	"yap/internal/vocabulary"
)

type chatVoiceCapture struct {
	id, sessionID, path string
	stop                chan struct{}
	done                chan struct{}
	stopped             bool
	text                string
	err                 error
}

type ChatVoiceProgress struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	Phase     string `json:"phase"`
	Text      string `json:"text"`
	Error     string `json:"error"`
}

// Chat speech owns the microphone as a cancellable text job, so global dictation
// shortcuts cannot paste it, create History, or stop a different recording.
func (a *App) StartChatVoice(requestID, sessionID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	if requestID == "" || len(requestID) > 80 || strings.ContainsAny(requestID, "\r\n\x00") {
		return errors.New("invalid voice request")
	}
	a.pruneTextCancellationsLocked()
	if _, cancelled := a.cancelledTextRequests[requestID]; cancelled {
		return context.Canceled
	}
	if a.busy() || a.textJobID != "" {
		return errors.New("finish the current operation before recording a chat message")
	}
	if _, err := a.store.Session(sessionID); err != nil {
		return err
	}
	settings := a.settings
	if err := speech.Validate(speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath}); err != nil {
		return err
	}
	file, path, err := a.store.CreateRecording()
	if err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return errors.Join(err, a.discardAudioLocked(path))
	}
	if err := a.recorder.Start(path, settings.MicrophoneID, func(float64) {}); err != nil {
		return errors.Join(err, a.discardAudioLocked(path))
	}
	voice := &chatVoiceCapture{id: requestID, sessionID: sessionID, path: path, stop: make(chan struct{}), done: make(chan struct{})}
	a.chatVoice = voice
	ctx, cancel, previous, savedText := a.beginTextJobLocked(requestID)
	a.status.Message = "Recording chat message…"
	a.emit()
	entries, _ := vocabulary.Normalize(a.vocabulary)
	go func() {
		defer a.wg.Done()
		defer cancel()
		ctx, timeout := context.WithTimeout(ctx, 5*time.Minute)
		defer timeout()
		timer := time.NewTimer(2 * time.Minute)
		defer timer.Stop()
		select {
		case <-voice.stop:
		case <-timer.C:
		case <-ctx.Done():
		}
		a.mu.Lock()
		duration, err := a.recorder.Stop()
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		if err == nil && duration < 300 {
			err = errors.New("record for at least a moment before stopping")
		}
		if err == nil && !a.closing {
			a.status.Message = "Transcribing chat message…"
			a.emit()
			a.event("chat:voice", ChatVoiceProgress{SessionID: sessionID, RequestID: requestID, Phase: "transcribing"})
		}
		a.mu.Unlock()
		var text string
		if err == nil {
			text, err = a.engine.Transcribe(ctx, path, speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath, Language: settings.Language, Prompt: vocabulary.Prompt(entries)})
			if err == nil {
				text = processTranscript(text, settings, entries)
				if strings.TrimSpace(text) == "" {
					err = speech.ErrNoSpeech
				}
			}
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		if _, entryErr := a.store.Session(sessionID); err == nil && entryErr != nil {
			err = errors.New("this transcription no longer exists")
		}
		if cleanupErr := a.discardAudioLocked(path); cleanupErr != nil {
			err = errors.Join(err, cleanupErr)
		}
		voice.text, voice.err = text, err
		phase := "done"
		if err != nil {
			voice.text = ""
			phase = "failed"
			if errors.Is(err, context.Canceled) {
				phase = "cancelled"
			}
		}
		// Keep the completed result until the next voice request. A delayed or
		// repeated Stop RPC must not lose an automatically completed recording.
		a.finishTextJobLocked(previous, savedText)
		if !a.closing {
			progress := ChatVoiceProgress{SessionID: sessionID, RequestID: requestID, Phase: phase, Text: voice.text}
			if err != nil {
				progress.Error = err.Error()
			}
			a.event("chat:voice", progress)
		}
		close(voice.done)
	}()
	return nil
}

func (a *App) StopChatVoice(requestID string) (string, error) {
	a.mu.Lock()
	voice := a.chatVoice
	if voice == nil || voice.id != requestID {
		a.mu.Unlock()
		return "", errors.New("this chat recording is no longer active")
	}
	if !voice.stopped {
		voice.stopped = true
		close(voice.stop)
	}
	a.mu.Unlock()
	<-voice.done
	return voice.text, voice.err
}
