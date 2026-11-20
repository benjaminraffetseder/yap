package modelmanagement

import (
	"context"
	"errors"
	"fmt"

	"yap/internal/audio"
	"yap/internal/models"
)

type AudioSupport struct {
	Installed   bool   `json:"installed"`
	Managed     bool   `json:"managed"`
	Path        string `json:"path"`
	CanDownload bool   `json:"canDownload"`
	Size        int64  `json:"size"`
	Message     string `json:"message"`
}

func AudioStatus(ctx context.Context, dir string) AudioSupport {
	managed := models.FFmpegPath(dir)
	path, err := audio.FindFFmpeg(ctx, managed)
	result := AudioSupport{Installed: err == nil, Managed: path != "" && path == managed, Path: path, CanDownload: models.CanInstallFFmpeg(), Size: models.FFmpegSize}
	switch {
	case errors.Is(err, audio.ErrFFmpegMissing):
		result.Message = "FFmpeg is not installed"
	case err != nil:
		result.Message = err.Error()
	case result.Managed:
		result.Message = "Installed by Yap"
	default:
		result.Message = "Using an existing FFmpeg installation"
	}
	return result
}

func AudioConfirmation(next string) string {
	return fmt.Sprintf("Download FFmpeg audio support (%.1f MiB)?\n\nYap will download FFmpeg from GitHub, verify it, and save it in Yap's application data folder. No administrator access or PATH changes are needed. Your audio stays on this device.\n\nThis build is licensed under LGPL v3 or later. Its licence and source information will be saved beside it.\n\n%s You can cancel the download in Yap.", float64(models.FFmpegSize)/(1<<20), next)
}

func AudioInstallSupported() error {
	if !models.CanInstallFFmpeg() {
		return errors.New("automatic audio support installation requires Windows x64")
	}
	return nil
}

type AudioOutcome struct {
	Phase, Message string
	Err            error
}

func CompleteAudio(ctx context.Context, err error) AudioOutcome {
	if ctx.Err() != nil {
		return AudioOutcome{Phase: "idle", Message: "Audio support download cancelled"}
	}
	if err != nil {
		return AudioOutcome{Err: err}
	}
	return AudioOutcome{Phase: "idle", Message: "Audio support installed. Ready to import."}
}
