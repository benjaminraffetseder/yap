package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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

func (a *App) GetAudioSupport() (AudioSupport, error) {
	a.mu.Lock()
	err := a.available()
	var dir string
	if err == nil {
		dir = a.store.Dir
	}
	a.mu.Unlock()
	if err != nil {
		return AudioSupport{}, err
	}
	managed := models.FFmpegPath(dir)
	path, err := audio.FindFFmpeg(a.ctx, managed)
	result := AudioSupport{Installed: err == nil, Managed: path != "" && path == managed, Path: path, CanDownload: models.CanInstallFFmpeg(), Size: models.FFmpegSize}
	if errors.Is(err, audio.ErrFFmpegMissing) {
		result.Message = "FFmpeg is not installed"
	} else if err != nil {
		result.Message = err.Error()
	} else if result.Managed {
		result.Message = "Installed by Yap"
	} else {
		result.Message = "Using an existing FFmpeg installation"
	}
	return result, nil
}

func (a *App) confirmAudioSupportDownload(next string) (bool, error) {
	answer, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type: runtime.QuestionDialog, Title: "Download audio support",
		Message: fmt.Sprintf("Download FFmpeg audio support (%.1f MiB)?\n\nYap will download FFmpeg from GitHub, verify it, and save it in Yap's application data folder. No administrator access or PATH changes are needed. Your audio stays on this device.\n\nThis build is licensed under LGPL v3 or later. Its licence and source information will be saved beside it.\n\n%s You can cancel the download in Yap.", float64(models.FFmpegSize)/(1<<20), next),
		Buttons: []string{"Yes", "No"}, DefaultButton: "No", CancelButton: "No",
	})
	return answer == "Yes", err
}

// InstallAudioSupport is independent of speech setup and never starts an import.
func (a *App) InstallAudioSupport() error {
	return a.installAudioSupport(func() (bool, error) {
		return a.confirmAudioSupportDownload("Audio support will be ready for future imports.")
	}, models.InstallFFmpeg)
}

func (a *App) audioSupportAvailableLocked() error {
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() || a.textJobID != "" {
		return errors.New("finish the current operation before installing audio support")
	}
	if !models.CanInstallFFmpeg() {
		return errors.New("automatic audio support installation requires Windows x64")
	}
	return nil
}

func (a *App) installAudioSupport(confirm func() (bool, error), install audioSupportInstaller) error {
	a.mu.Lock()
	err := a.audioSupportAvailableLocked()
	a.mu.Unlock()
	if err != nil {
		return err
	}
	confirmed, err := confirm()
	if err != nil || !confirmed {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.audioSupportAvailableLocked(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Minute)
	a.cancel = cancel
	a.status.Phase, a.status.Message, a.status.Progress, a.status.StartedAt = "downloading", "Downloading audio support…", 0, 0
	a.emit()
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		defer cancel()
		_, err := install(ctx, a.store.Dir, func(n, total int64) {
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
		a.mu.Lock()
		defer a.mu.Unlock()
		a.cancel = nil
		if a.closing {
			return
		}
		a.status.Progress = 0
		if ctx.Err() != nil {
			a.status.Phase, a.status.Message = "idle", "Audio support download cancelled"
		} else if err != nil {
			a.fail(err)
			return
		} else {
			a.status.Phase, a.status.Message = "idle", "Audio support installed. Ready to import."
		}
		a.emit()
	}()
	return nil
}
