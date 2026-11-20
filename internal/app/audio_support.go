package app

import (
	"context"
	"errors"
	"time"

	"yap/internal/app/modelmanagement"
	"yap/internal/models"
)

type AudioSupport = modelmanagement.AudioSupport

func (a *App) GetAudioSupport() (AudioSupport, error) {
	a.mu.Lock()
	err := a.availableLocked()
	var dir string
	if err == nil {
		dir = a.store.Dir
	}
	a.mu.Unlock()
	if err != nil {
		return AudioSupport{}, err
	}
	return modelmanagement.AudioStatus(a.ctx, dir), nil
}

func (a *App) confirmAudioSupportDownload(next string) (bool, error) {
	dialog := a.desktop.Dialog.Question().SetTitle("Download audio support").AttachToWindow(a.window)
	dialog.SetMessage(modelmanagement.AudioConfirmation(next))
	answer := make(chan bool, 1)
	dialog.AddButton("Yes").OnClick(func() { answer <- true })
	dialog.AddButton("No").SetAsDefault().SetAsCancel().OnClick(func() { answer <- false })
	dialog.Show()
	// Attached dialogs may return before their button callback runs.
	select {
	case accepted := <-answer:
		return accepted, nil
	case <-a.ctx.Done():
		return false, a.ctx.Err()
	}
}

// InstallAudioSupport is independent of speech setup and never starts an import.
func (a *App) InstallAudioSupport() error {
	return a.installAudioSupport(func() (bool, error) {
		return a.confirmAudioSupportDownload("Audio support will be ready for future imports.")
	}, models.InstallFFmpeg)
}

// UpdateAudioSupport reuses download ownership and cancellation without
// starting an import or changing a system/custom decoder installation.
func (a *App) UpdateAudioSupport() error {
	return a.installAudioSupport(func() (bool, error) { return true, nil }, models.UpdateFFmpegRuntime)
}

func (a *App) audioSupportAvailableLocked() error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	if a.busyLocked() || a.textJobID != "" {
		return errors.New("finish the current operation before installing audio support")
	}
	return modelmanagement.AudioInstallSupported()
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
	a.emitStatusLocked()
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
			a.emitStatusLocked()
		})
		a.mu.Lock()
		defer a.mu.Unlock()
		a.cancel = nil
		if a.closing {
			return
		}
		a.status.Progress = 0
		outcome := modelmanagement.CompleteAudio(ctx, err)
		if outcome.Err != nil {
			a.failLocked(outcome.Err)
			return
		}
		a.status.Phase, a.status.Message = outcome.Phase, outcome.Message
		a.emitStatusLocked()
	}()
	return nil
}
