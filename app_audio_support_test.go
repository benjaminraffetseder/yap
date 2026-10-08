package main

import (
	"context"
	"errors"
	"testing"

	"yap/internal/models"
)

func TestSettingsAudioSupportInstallLifecycle(t *testing.T) {
	if !models.CanInstallFFmpeg() {
		t.Skip("Windows x64 download")
	}
	for _, outcome := range []string{"decline", "success", "failure", "cancel", "shutdown", "busy-after-dialog"} {
		t.Run(outcome, func(t *testing.T) {
			a := testApp(t)
			a.settings.ModelPath, a.settings.WhisperPath = "", "" // independent of dictation setup
			started := make(chan struct{})
			called := false
			err := a.installAudioSupport(func() (bool, error) {
				if outcome == "busy-after-dialog" {
					a.mu.Lock()
					a.status.Phase = "backup"
					a.mu.Unlock()
				}
				return outcome != "decline", nil
			}, func(ctx context.Context, dir string, report func(int64, int64)) (string, error) {
				called = true
				report(1, 2)
				close(started)
				if outcome == "failure" {
					return "", errors.New("checksum mismatch")
				}
				if outcome == "cancel" || outcome == "shutdown" {
					<-ctx.Done()
					return "", ctx.Err()
				}
				report(2, 2)
				return "ffmpeg.exe", nil
			})
			if outcome == "busy-after-dialog" {
				if err == nil || called {
					t.Fatal("installed while busy")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if outcome != "decline" {
				<-started
			}
			if outcome == "cancel" {
				if err := a.Cancel(); err != nil {
					t.Fatal(err)
				}
			}
			if outcome == "shutdown" {
				a.shutdown(a.ctx)
			}
			a.wg.Wait()
			if outcome == "decline" && called {
				t.Fatal("downloaded without confirmation")
			}
			if a.cancel != nil {
				t.Fatal("cancel handle leaked")
			}
			if a.path != "" {
				t.Fatal("settings download started an import")
			}
			if outcome == "shutdown" {
				return
			}
			if history, _ := a.store.History(); len(history) != 0 {
				t.Fatal("settings download created history")
			}
			if outcome == "failure" {
				if a.status.Phase != "error" || a.status.Message != "checksum mismatch" {
					t.Fatal(a.status)
				}
			} else if a.status.Phase != "idle" {
				t.Fatal(a.status)
			}
			if outcome == "success" && a.status.Message != "Audio support installed. Ready to import." {
				t.Fatal(a.status)
			}
		})
	}
}

func TestSettingsAudioSupportChecksBusyBeforeConfirmation(t *testing.T) {
	a := testApp(t)
	a.status.Phase = "recording"
	err := a.installAudioSupport(func() (bool, error) { t.Fatal("confirmed while busy"); return true, nil }, nil)
	if err == nil {
		t.Fatal("accepted concurrent download")
	}
	a.status.Phase = "idle"
}

func TestGetAudioSupportUsesDiscoveryWithoutSpeechModel(t *testing.T) {
	a := testApp(t)
	a.settings.ModelPath = ""
	t.Setenv("PATH", "")
	info, err := a.GetAudioSupport()
	if err != nil || info.Installed || info.Path != "" || info.Size != models.FFmpegSize || info.CanDownload != models.CanInstallFFmpeg() {
		t.Fatal(info, err)
	}
}
