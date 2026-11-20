// Package recording owns microphone preparation, recognized results, and their
// durability and delivery rules. The application owns operation arbitration,
// locking, worker lifetimes, and publication of native/UI effects.
package recording

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/google/uuid"
	"yap/internal/audio"
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

type Capture struct {
	ID         string
	Path       string
	Settings   storage.Settings
	TextConfig textmodel.Config
	Vocabulary []vocabulary.Entry
}

// Prepare validates speech before allocating audio or replacing a previous
// result. Configuration is captured once for the whole recording operation.
func Prepare(settings storage.Settings, config textmodel.Config, entries []vocabulary.Entry, create func() (*os.File, string, error), discard func(string) error) (Capture, error) {
	if err := speech.Validate(speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath, Language: settings.Language}); err != nil {
		return Capture{}, err
	}
	file, path, err := create()
	if err != nil {
		return Capture{}, err
	}
	if err := file.Close(); err != nil {
		return Capture{}, errors.Join(err, discard(path))
	}
	config, _ = textmodel.Normalize(config)
	entries, _ = vocabulary.Normalize(entries)
	return Capture{ID: uuid.NewString(), Path: path, Settings: settings, TextConfig: config, Vocabulary: entries}, nil
}

func (capture Capture) Start(recorder audio.Capture, microphoneID string, level func(float64), discard func(string) error) error {
	if err := recorder.Start(capture.Path, microphoneID, level); err != nil {
		return errors.Join(err, discard(capture.Path))
	}
	return nil
}

// Stop rejects captures too short to transcribe. The caller keeps cleanup in
// its operation reservation, before publishing an idle or error state.
func Stop(recorder audio.Capture) (int64, error) {
	duration, err := recorder.Stop()
	if err == nil && duration < 300 {
		err = errors.New("record for at least a moment before releasing")
	}
	return duration, err
}

type Recognition struct {
	Text            string
	TranscriptionMS float64
}

func Recognize(ctx context.Context, engine speech.Engine, path string, settings storage.Settings, entries []vocabulary.Entry, progress func(float64)) (Recognition, error) {
	started := time.Now()
	text, err := engine.Transcribe(ctx, path, speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath, Language: settings.Language, Prompt: vocabulary.Prompt(entries), Progress: progress})
	return Recognition{Text: text, TranscriptionMS: float64(time.Since(started)) / float64(time.Millisecond)}, err
}

func CapturePasteTarget(external bool, settings storage.Settings) bool {
	return external && settings.AutoCopy && settings.AutoPaste
}
