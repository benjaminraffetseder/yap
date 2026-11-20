// Package modelmanagement owns model and audio-support installation workflows.
// The caller reserves the operation and publishes native progress and results.
package modelmanagement

import (
	"context"
	"errors"

	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/models"
	"yap/internal/storage"
)

type SpeechInstall struct{ id string }
type TextInstall struct{ id string }
type SpeechResult struct{ executable, model string }

func PrepareSpeech(id string) (SpeechInstall, error) {
	for _, model := range models.Catalog {
		if model.ID == id {
			return SpeechInstall{id: id}, nil
		}
	}
	return SpeechInstall{}, errors.New("unknown model")
}

func (plan SpeechInstall) Run(ctx context.Context, dir, executable string, progress func(int64, int64), stage func(string)) (SpeechResult, error) {
	executable, err := models.EnsureModelRuntime(ctx, dir, plan.id, executable, progress)
	var model string
	if err == nil {
		stage("Checking or downloading " + plan.id + "…")
		model, err = models.Install(ctx, dir, plan.id, progress)
	}
	return SpeechResult{executable: executable, model: model}, err
}

func (result SpeechResult) Settings(current storage.Settings) storage.Settings {
	if speech.Kind(result.model) == "whisper" {
		current.WhisperPath = result.executable
	}
	current.ModelPath = result.model
	return current
}

func PrepareText(id string) (TextInstall, error) {
	if _, ok := models.FindTextModel(id); !ok {
		return TextInstall{}, errors.New("unknown text model")
	}
	if !models.TextRuntimeAvailable() {
		return TextInstall{}, errors.New("built-in text models require Windows x64 or Linux x64/arm64")
	}
	return TextInstall{id: id}, nil
}

func (plan TextInstall) Run(ctx context.Context, dir string, progress func(int64, int64), stage func(string)) error {
	err := models.EnsureTextRuntime(ctx, dir, progress)
	if err == nil {
		stage("Checking or downloading " + plan.id + "…")
		err = models.InstallTextModel(ctx, dir, plan.id, progress)
	}
	return err
}

func RemoveText(dir, id string, config textmodel.Config, release func()) error {
	if config.Provider == "builtin" && config.Model == id {
		return errors.New("select another text model or an external server before removing this model")
	}
	release()
	return models.RemoveTextModel(dir, id)
}

func RemoveSpeech(dir, id, selected string) error { return models.Remove(dir, id, selected) }

func FileSelection(kind string) (label, pattern string, err error) {
	switch kind {
	case "model":
		return "Speech model", "*.bin;*.gguf", nil
	case "runtime":
		return "Whisper executable", "*", nil
	default:
		return "", "", errors.New("unknown file type")
	}
}
