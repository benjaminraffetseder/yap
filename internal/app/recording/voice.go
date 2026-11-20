package recording

import (
	"context"
	"errors"
	"strings"

	"yap/internal/audio"
	"yap/internal/inference/speech"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

type VoiceProgress struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	Phase     string `json:"phase"`
	Text      string `json:"text"`
	Error     string `json:"error"`
}

// VoiceCapture retains its completed draft until the next request replaces it.
// Mutation is serialized by the caller's operation lock; Done publishes the
// final result after cleanup and restoration of the previous application state.
type VoiceCapture struct {
	id, sessionID, path string
	stop, done          chan struct{}
	stopped             bool
	text                string
	err                 error
	settings            storage.Settings
	entries             []vocabulary.Entry
}

func ValidateVoiceRequest(requestID string) error {
	if requestID == "" || len(requestID) > 80 || strings.ContainsAny(requestID, "\r\n\x00") {
		return errors.New("invalid voice request")
	}
	return nil
}

func NewVoice(requestID, sessionID string, capture Capture) *VoiceCapture {
	return &VoiceCapture{id: requestID, sessionID: sessionID, path: capture.Path, settings: capture.Settings, entries: capture.Vocabulary, stop: make(chan struct{}), done: make(chan struct{})}
}

func (voice *VoiceCapture) ID() string                  { return voice.id }
func (voice *VoiceCapture) Path() string                { return voice.path }
func (voice *VoiceCapture) Done() <-chan struct{}       { return voice.done }
func (voice *VoiceCapture) StopSignal() <-chan struct{} { return voice.stop }
func (voice *VoiceCapture) Result() (string, error)     { return voice.text, voice.err }

func (voice *VoiceCapture) Stop() {
	if !voice.stopped {
		voice.stopped = true
		close(voice.stop)
	}
}

func (voice *VoiceCapture) StopCapture(ctx context.Context, recorder audio.Capture) error {
	duration, err := recorder.Stop()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err == nil && duration < 300 {
		return errors.New("record for at least a moment before stopping")
	}
	return err
}

func (voice *VoiceCapture) Recognize(ctx context.Context, engine speech.Engine) (string, error) {
	recognized, err := Recognize(ctx, engine, voice.path, voice.settings, voice.entries, nil)
	if err != nil {
		return recognized.Text, err
	}
	text := ProcessTranscript(recognized.Text, voice.settings, voice.entries)
	if strings.TrimSpace(text) == "" {
		return text, speech.ErrNoSpeech
	}
	return text, nil
}

func (voice *VoiceCapture) Progress(phase string) VoiceProgress {
	return VoiceProgress{SessionID: voice.sessionID, RequestID: voice.id, Phase: phase}
}

// Finalize preserves cancellation precedence and suppresses a draft whose
// History parent disappeared. Audio deletion failures are always retained.
func (voice *VoiceCapture) Finalize(ctx context.Context, err error, sessionExists, discard func() error) error {
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	if sessionErr := sessionExists(); err == nil && sessionErr != nil {
		err = errors.New("this transcription no longer exists")
	}
	if cleanupErr := discard(); cleanupErr != nil {
		err = errors.Join(err, cleanupErr)
	}
	return err
}

// Finish retains the result, then calls publish to restore the previous state
// and publish progress before waking Stop callers. Audio is already discarded.
func (voice *VoiceCapture) Finish(text string, err error, publish func(VoiceProgress)) {
	voice.text, voice.err = text, err
	progress := voice.Progress("done")
	if err != nil {
		voice.text, progress.Phase, progress.Error = "", "failed", err.Error()
		if errors.Is(err, context.Canceled) {
			progress.Phase = "cancelled"
		}
	}
	progress.Text = voice.text
	if publish != nil {
		publish(progress)
	}
	close(voice.done)
}
