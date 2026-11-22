package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/models"
	"yap/internal/startup"
	"yap/internal/storage"
	"yap/internal/tray"
	"yap/internal/vocabulary"
)

func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	defer func() {
		a.startupComplete = true
		show := a.initialWindowLocked()
		a.mu.Unlock()
		if show != nil {
			show()
		}
	}()
	if a.closing {
		return
	}
	a.ctx = ctx
	var err error
	defer a.updateTrayLocked()
	root, err := os.UserConfigDir()
	if err != nil {
		a.failLocked(err)
		return
	}
	a.store, err = storage.Open(filepath.Join(root, "yap"))
	if err != nil {
		a.failLocked(err)
		return
	}
	a.engine = speech.NewManaged(a.store.Dir)
	a.textEngine = &textmodel.Managed{Dir: a.store.Dir}
	a.settings, err = a.store.Settings()
	if err != nil {
		a.failLocked(err)
		return
	}
	a.settings.WhisperPath = models.PreferredRuntime(a.settings.WhisperPath)
	if err := a.profiles.Load(a.store); err != nil {
		a.failLocked(fmt.Errorf("could not load dictation profiles: %w", err))
		return
	}
	a.textConfig, err = a.store.TextProcessing()
	if err != nil {
		a.failLocked(fmt.Errorf("could not load prompts: %w", err))
		return
	}
	if err := a.ensureDefaultProfileLocked(); err != nil {
		a.failLocked(fmt.Errorf("could not initialize Default profile: %w", err))
		return
	}
	a.pruneHistoryLocked()
	a.scheduleHistoryCleanupLocked()
	a.vocabulary, err = a.store.Vocabulary()
	if err != nil {
		a.failLocked(err)
		return
	}
	normalizedVocabulary, err := vocabulary.Normalize(a.vocabulary)
	if err != nil {
		// Keep legacy conflicting terms visible so they can be repaired in Vocabulary.
		a.failLocked(fmt.Errorf("open Vocabulary to resolve saved terms: %w", err))
		return
	}
	a.vocabulary = normalizedVocabulary
	if !a.development {
		a.loginStart, err = startup.New()
		if err == nil && a.loginStart != nil {
			var enabled bool
			enabled, err = a.loginStart.Enabled()
			if err == nil {
				a.settings.LaunchAtLogin = enabled
			}
		}
		if err != nil {
			a.status.StartupError = "Launch at login unavailable: " + err.Error()
			a.loginStart = nil
		}
	}
	a.registerMissingShortcutsLocked()
}

func (a *App) quit() {
	a.mu.Lock()
	if a.closing || a.quitRequested {
		a.mu.Unlock()
		return
	}
	a.quitRequested = true
	quit := a.quitApplication
	a.mu.Unlock()
	if quit != nil {
		quit()
	}
}

// Wails calls ShouldQuit on its UI thread. A worker can hold App.mu while
// awaiting a clipboard/UI callback, so this gate must not acquire that mutex
// or wait for shutdown. Retry native Quit only after all cleanup has finished.
func (a *App) shouldQuit() bool {
	if a.shutdownComplete.Load() {
		return true
	}
	a.quitOnce.Do(func() {
		go func() {
			a.mu.Lock()
			ctx := a.ctx
			a.mu.Unlock()
			a.shutdown(ctx)
			a.mu.Lock()
			quit := a.quitApplication
			a.mu.Unlock()
			if quit != nil {
				quit()
			}
		}()
	})
	return false
}

func (a *App) shutdown(ctx context.Context) {
	a.shutdownOnce.Do(func() {
		a.mu.Lock()
		a.closing = true
		if a.lifecycleCancel != nil {
			a.lifecycleCancel()
		}
		a.shortcuts.CancelRegistration()
		if a.historyCleanupTimer != nil {
			a.historyCleanupTimer.Stop()
		}
		a.latestResult = nil
		a.audioLinks = nil
		a.clearHomeResultLocked()
		a.status.Transcript = ""
		a.updating.Cancel()
		if a.tray != nil {
			a.tray.Update(tray.State{Phase: "closing"})
		}
		if a.timer != nil {
			a.timer.Stop()
		}
		if a.cancel != nil {
			a.cancel()
		}
		if a.textCancel != nil {
			a.textCancel()
		}
		for _, cancel := range a.modelDiscoveryCancels {
			cancel()
		}
		if a.status.Phase == "recording" || a.status.Phase == "mic-test" || a.status.Phase == "diagnostic-recording" {
			a.recorder.Stop()
			_ = a.discardAudioLocked(a.path)
		}
		registrations := a.shortcuts.Shutdown()
		audioServer := a.audioServer
		a.mu.Unlock()
		if audioServer != nil {
			_ = audioServer.Close()
		}
		for _, registration := range registrations {
			registration.Close()
		}
		a.wg.Wait()
		if engine, ok := a.engine.(interface{ Close() }); ok {
			engine.Close()
		}
		if engine, ok := a.textEngine.(interface{ Close() }); ok {
			engine.Close()
		}
		_ = a.backups.Close()
		if a.indicator != nil {
			a.indicator.Close()
		}
		if a.tray != nil {
			a.tray.Close()
		}
		if a.store != nil {
			a.store.Close()
		}
		a.shutdownComplete.Store(true)
	})
}
