package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"yap/internal/audio"
	"yap/internal/indicator"
	"yap/internal/inference/speech"
	"yap/internal/models"
	"yap/internal/platform"
	"yap/internal/storage"
)

type Status struct {
	Phase          string  `json:"phase"`
	Message        string  `json:"message"`
	StartedAt      int64   `json:"startedAt"`
	Transcript     string  `json:"transcript"`
	Progress       float64 `json:"progress"`
	ShortcutError  string  `json:"shortcutError"`
	IndicatorError string  `json:"indicatorError"`
}
type Snapshot struct {
	Settings          storage.Settings  `json:"settings"`
	Status            Status            `json:"status"`
	History           []storage.Session `json:"history"`
	Models            []models.Model    `json:"models"`
	DataDir           string            `json:"dataDir"`
	Ready             bool              `json:"ready"`
	FloatingIndicator bool              `json:"floatingIndicator"`
}
type App struct {
	ctx              context.Context
	mu               sync.Mutex
	store            *storage.Store
	settings         storage.Settings
	status           Status
	shortcut         *platform.Shortcut
	recorder         audio.Capture
	microphones      func() ([]audio.Device, error)
	engine           speech.Engine
	id, path, target string
	recordSettings   storage.Settings
	timer            *time.Timer
	cancel           context.CancelFunc
	wg               sync.WaitGroup
	closing          bool
	shutdownOnce     sync.Once
	notify           func(string, ...interface{})
	copyText         func(string) error
	indicator        indicator.Controller
	indicatorActive  bool
}

func NewApp() *App {
	return &App{settings: storage.Defaults(), status: Status{Phase: "idle", Message: "Ready when you are"}, recorder: audio.New(), microphones: audio.Devices, engine: speech.Whisper{}}
}
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.notify = func(topic string, data ...interface{}) { runtime.EventsEmit(ctx, topic, data...) }
	a.copyText = func(text string) error { return runtime.ClipboardSetText(ctx, text) }
	root, err := os.UserConfigDir()
	if err != nil {
		a.status = Status{Phase: "error", Message: err.Error()}
		return
	}
	a.store, err = storage.Open(filepath.Join(root, "yap"))
	if err != nil {
		a.status = Status{Phase: "error", Message: err.Error()}
		return
	}
	a.settings, err = a.store.Settings()
	if err != nil {
		a.status = Status{Phase: "error", Message: err.Error()}
		return
	}
	a.settings.WhisperPath = models.PreferredRuntime(a.settings.WhisperPath)
	a.indicator, err = indicator.New(indicator.Actions{
		Stop:   func() { _ = a.StopRecording() },
		Cancel: func() { _ = a.Cancel() },
		Show:   func() { runtime.WindowUnminimise(ctx); runtime.WindowShow(ctx) },
	})
	if err != nil {
		a.status.IndicatorError = "Floating indicator unavailable: " + err.Error()
	}
	a.registerShortcut()
}
func (a *App) shutdown(ctx context.Context) {
	a.shutdownOnce.Do(func() {
		a.mu.Lock()
		a.closing = true
		if a.timer != nil {
			a.timer.Stop()
		}
		if a.cancel != nil {
			a.cancel()
		}
		if a.status.Phase == "recording" {
			a.recorder.Stop()
			os.Remove(a.path)
		}
		s := a.shortcut
		a.shortcut = nil
		a.mu.Unlock()
		if s != nil {
			s.Close()
		}
		a.wg.Wait()
		if a.indicator != nil {
			a.indicator.Close()
		}
		if a.store != nil {
			a.store.Close()
		}
	})
}
func (a *App) emit() {
	if a.ctx != nil && !a.closing {
		if a.indicator != nil && a.indicatorActive {
			a.indicator.Update(indicator.State{Phase: a.status.Phase, Message: a.status.Message, StartedAt: a.status.StartedAt})
			if a.status.Phase != "recording" && a.status.Phase != "transcribing" {
				a.indicatorActive = false
			}
		}
		a.event("dictation:status", a.status)
	}
}
func (a *App) event(topic string, data ...interface{}) {
	if a.notify != nil {
		a.notify(topic, data...)
	}
}
func (a *App) fail(err error) {
	a.status.Phase = "error"
	a.status.Message = err.Error()
	a.status.StartedAt = 0
	a.emit()
}
func (a *App) available() error {
	if a.closing {
		return errors.New("app is shutting down")
	}
	if a.store == nil {
		return errors.New("local database unavailable: " + a.status.Message)
	}
	return nil
}
func (a *App) busy() bool {
	return a.status.Phase == "recording" || a.status.Phase == "transcribing" || a.status.Phase == "downloading"
}
func (a *App) registerShortcut() {
	s, err := platform.Register(a.settings.Shortcut, a.hotkeyDown, a.hotkeyUp)
	if err != nil {
		a.status.ShortcutError = err.Error()
		return
	}
	a.shortcut = s
	a.status.ShortcutError = ""
}
func (a *App) hotkeyDown() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing {
		return
	}
	if a.settings.Interaction == "toggle" && a.status.Phase == "recording" {
		a.stop()
		return
	}
	if a.busy() {
		return
	}
	if err := a.start(true); err != nil {
		a.fail(err)
	}
}
func (a *App) hotkeyUp() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.closing && a.settings.Interaction == "hold" && a.status.Phase == "recording" {
		a.stop()
	}
}
func (a *App) GetSnapshot() (Snapshot, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return Snapshot{}, err
	}
	history, err := a.store.History()
	if err != nil {
		return Snapshot{}, err
	}
	ready := speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath}) == nil
	return Snapshot{Settings: a.settings, Status: a.status, History: history, Models: models.List(a.store.Dir), DataDir: a.store.Dir, Ready: ready, FloatingIndicator: a.indicator != nil}, nil
}
func (a *App) GetMicrophones() ([]audio.Device, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return nil, err
	}
	return a.microphones()
}

func (a *App) StartRecording() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	err := a.start(false)
	if err != nil && a.indicatorActive && !a.busy() {
		a.fail(err)
	}
	return err
}
func (a *App) start(external bool) error {
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation first")
	}
	a.indicatorActive = true
	if err := speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath}); err != nil {
		return err
	}
	a.id = uuid.NewString()
	a.path = filepath.Join(a.store.Dir, "recordings", a.id+".wav")
	a.target = ""
	if external && a.settings.AutoPaste {
		a.target = platform.Target()
	}
	if err := a.recorder.Start(a.path, a.settings.MicrophoneID, func(level float64) {
		a.event("dictation:level", level)
		if a.indicator != nil {
			a.indicator.SetLevel(level)
		}
	}); err != nil {
		os.Remove(a.path)
		return err
	}
	a.recordSettings = a.settings
	a.status.Phase = "recording"
	a.status.Message = "Listening…"
	a.status.Transcript = ""
	a.status.StartedAt = time.Now().UnixMilli()
	a.status.Progress = 0
	a.emit()
	id := a.id
	a.timer = time.AfterFunc(10*time.Minute, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if !a.closing && a.id == id && a.status.Phase == "recording" {
			a.stop()
		}
	})
	return nil
}
func (a *App) StopRecording() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.status.Phase != "recording" {
		return errors.New("no recording in progress")
	}
	a.stop()
	return nil
}
func (a *App) stop() {
	if a.timer != nil {
		a.timer.Stop()
	}
	duration, err := a.recorder.Stop()
	if err != nil {
		os.Remove(a.path)
		a.fail(err)
		return
	}
	if duration < 300 {
		os.Remove(a.path)
		a.fail(errors.New("record for at least a moment before releasing"))
		return
	}
	a.status.Phase = "transcribing"
	a.status.Message = "Transcribing on your device…"
	a.emit()
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Minute)
	a.cancel = cancel
	id, path, target, settings := a.id, a.path, a.target, a.recordSettings
	a.wg.Add(1)
	go func() { defer a.wg.Done(); defer cancel(); a.transcribe(ctx, id, path, target, duration, settings) }()
}
func (a *App) transcribe(ctx context.Context, id, path, target string, duration int64, settings storage.Settings) {
	persisted := false
	defer func() {
		if !persisted || !settings.SaveAudio {
			os.Remove(path)
		}
	}()
	text, err := a.engine.Transcribe(ctx, path, speech.Options{Executable: settings.WhisperPath, Model: settings.ModelPath, Language: settings.Language})
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cancel = nil
	if a.closing {
		return
	}
	if ctx.Err() != nil {
		a.status.Phase = "idle"
		a.status.Message = "Transcription cancelled"
		a.status.StartedAt = 0
		a.emit()
		return
	}
	if err != nil {
		a.fail(err)
		return
	}
	audioPath := ""
	if settings.SaveAudio {
		audioPath = path
	}
	session := storage.NewSession(id, duration, text, filepath.Base(settings.ModelPath), settings.Language, audioPath)
	if err = a.store.Add(session); err != nil {
		a.fail(fmt.Errorf("could not save transcript: %w", err))
		return
	}
	persisted = true
	a.status.Transcript = text
	a.status.StartedAt = 0
	a.status.Phase = "done"
	a.status.Message = "Copied to clipboard"
	if err = a.copyText(text); err != nil {
		a.status.Message = "Saved to history; clipboard failed: " + err.Error()
	} else if target != "" {
		if err = platform.Paste(target); err != nil {
			a.status.Message = err.Error()
		} else {
			a.status.Message = "Pasted into your application"
		}
	}
	a.emit()
	a.event("dictation:history")
}
func (a *App) Cancel() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.status.Phase == "recording" {
		a.timer.Stop()
		a.recorder.Stop()
		os.Remove(a.path)
		a.status.Phase = "idle"
		a.status.Message = "Recording discarded"
		a.status.StartedAt = 0
		a.emit()
	} else if a.cancel != nil {
		a.cancel()
		a.status.Message = "Cancelling…"
		a.emit()
	}
	return nil
}
func (a *App) SaveSettings(settings storage.Settings) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation before changing settings")
	}
	if settings.Interaction != "hold" && settings.Interaction != "toggle" {
		return errors.New("choose hold or toggle recording")
	}
	if !regexp.MustCompile(`^(auto|[a-z]{2,3})$`).MatchString(settings.Language) {
		return errors.New("use auto or a language code such as en or de")
	}
	if _, _, err := platform.ParseShortcut(settings.Shortcut); err != nil {
		return err
	}
	if settings.MicrophoneID != "" && settings.MicrophoneID != a.settings.MicrophoneID {
		devices, err := a.microphones()
		if err != nil {
			return err
		}
		found := false
		for _, device := range devices {
			if device.ID == settings.MicrophoneID {
				found = true
				break
			}
		}
		if !found {
			return errors.New("selected microphone is unavailable; refresh microphones in Settings and choose a connected device")
		}
	}
	old := a.settings
	if old.Shortcut != settings.Shortcut {
		oldKey := a.shortcut
		a.shortcut = nil
		if oldKey != nil {
			oldKey.Close()
		}
		a.settings = settings
		a.registerShortcut()
		if a.shortcut == nil {
			failure := a.status.ShortcutError
			a.settings = old
			a.registerShortcut()
			return fmt.Errorf("shortcut could not be registered: %s", failure)
		}
	}
	if err := a.store.SaveSettings(settings); err != nil {
		if a.settings.Shortcut != old.Shortcut && a.shortcut != nil {
			a.shortcut.Close()
			a.shortcut = nil
		}
		a.settings = old
		if a.shortcut == nil {
			a.registerShortcut()
		}
		return err
	}
	a.settings = settings
	if a.shortcut == nil {
		a.registerShortcut()
	}
	a.emit()
	return nil
}
func (a *App) SelectFile(kind string) (string, error) {
	label := "Whisper model"
	pattern := "*.bin"
	if kind == "runtime" {
		label = "Whisper executable"
		pattern = "*"
	} else if kind != "model" {
		return "", errors.New("unknown file type")
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Select " + label, Filters: []runtime.FileFilter{{DisplayName: label, Pattern: pattern}}})
}
func (a *App) InstallModel(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation first")
	}
	valid := false
	for _, m := range models.Catalog {
		if m.ID == id {
			valid = true
		}
	}
	if !valid {
		return errors.New("unknown model")
	}
	a.status.Phase = "downloading"
	a.status.Message = "Downloading Whisper runtime…"
	a.status.Progress = 0
	a.emit()
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancel = cancel
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		defer cancel()
		progress := func(n, total int64) {
			a.mu.Lock()
			defer a.mu.Unlock()
			a.status.Progress = float64(n) / float64(total)
			a.emit()
		}
		a.mu.Lock()
		executable := a.settings.WhisperPath
		a.mu.Unlock()
		var err error
		if executable == "" {
			executable, err = models.InstallRuntime(ctx, a.store.Dir, progress)
		}
		var model string
		if err == nil {
			a.mu.Lock()
			a.status.Message = "Downloading Whisper " + id + "…"
			a.status.Progress = 0
			a.emit()
			a.mu.Unlock()
			model, err = models.Install(ctx, a.store.Dir, id, progress)
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		a.cancel = nil
		if a.closing {
			return
		}
		if ctx.Err() != nil {
			a.status.Phase = "idle"
			a.status.Message = "Download cancelled"
			a.emit()
			return
		}
		if err != nil {
			a.fail(err)
			return
		}
		settings := a.settings
		settings.WhisperPath = executable
		settings.ModelPath = model
		if err = a.store.SaveSettings(settings); err != nil {
			a.fail(err)
			return
		}
		a.settings = settings
		a.status.Phase = "idle"
		a.status.Message = "Model installed. Ready to dictate."
		a.status.Progress = 0
		a.emit()
		a.event("dictation:history")
	}()
	return nil
}
func (a *App) CopyText(text string) error { return runtime.ClipboardSetText(a.ctx, text) }
func (a *App) DeleteSession(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	return a.store.Delete(id)
}
func (a *App) GetAudio(id string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return "", err
	}
	v, err := a.store.Session(id)
	if err != nil {
		return "", err
	}
	if v.AudioPath == "" {
		return "", errors.New("audio was not retained")
	}
	if filepath.Dir(v.AudioPath) != filepath.Join(a.store.Dir, "recordings") {
		return "", errors.New("invalid audio path")
	}
	info, err := os.Stat(v.AudioPath)
	if err != nil {
		return "", err
	}
	if info.Size() > 20*1024*1024 {
		return "", errors.New("audio file is too large")
	}
	data, err := os.ReadFile(v.AudioPath)
	if err != nil {
		return "", err
	}
	return "data:audio/wav;base64," + base64.StdEncoding.EncodeToString(data), nil
}
func (a *App) ExportSession(id string) error {
	a.mu.Lock()
	if err := a.available(); err != nil {
		a.mu.Unlock()
		return err
	}
	v, err := a.store.Session(id)
	a.mu.Unlock()
	if err != nil {
		return err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Export transcript", DefaultFilename: "dictation.txt", Filters: []runtime.FileFilter{{DisplayName: "Text", Pattern: "*.txt"}}})
	if err != nil || path == "" {
		return err
	}
	return os.WriteFile(path, []byte(v.RawTranscript+"\n"), 0600)
}
