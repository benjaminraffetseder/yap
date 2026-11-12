package main

import (
	"context"
	_ "embed"
	"errors"
	"path/filepath"
	goruntime "runtime"

	"yap/internal/updates"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"gopkg.in/yaml.v3"
)

// A separate public release repository can be selected with -ldflags "-X main.updateRepository=owner/repo".
var updateRepository = "benjaminraffetseder/yap"

// Use the same version for update checks and native executable metadata.
//
//go:embed build/config.yml
var appBuildConfig []byte

func appVersion() string {
	var config struct {
		Info struct {
			Version string `yaml:"version"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal(appBuildConfig, &config); err != nil {
		panic(err)
	}
	return config.Info.Version
}

func (a *App) updateCheckerLocked() (*updates.Checker, error) {
	if err := a.available(); err != nil {
		return nil, err
	}
	if a.updateChecker == nil {
		if a.desktop == nil {
			return nil, errors.New("desktop updater unavailable")
		}
		a.updateChecker = updates.New(appVersion(), updateRepository, filepath.Join(a.store.Dir, "update-check.json"), a.desktop.Updater)
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		a.updateContext, a.updateCancel = context.WithCancel(ctx)
	}
	return a.updateChecker, nil
}

func updatesSupported() bool {
	return (goruntime.GOOS == "windows" && goruntime.GOARCH == "amd64") ||
		(goruntime.GOOS == "darwin" && (goruntime.GOARCH == "amd64" || goruntime.GOARCH == "arm64"))
}

func configureUpdater(engine *updater.Updater) error {
	if updateRepository == "" || !updatesSupported() {
		return nil
	}
	provider, err := updates.NewGitHub(updateRepository)
	if err != nil {
		return err
	}
	return engine.Init(updater.Config{
		CurrentVersion: appVersion(),
		Providers:      []updater.Provider{provider},
		Window: &updater.BuiltinWindow{Options: updater.WindowOptions{
			Title: "Yap Update",
		}},
	})
}

func (a *App) GetUpdateStatus() (updates.Status, error) {
	a.mu.Lock()
	checker, err := a.updateCheckerLocked()
	a.mu.Unlock()
	if err != nil {
		return updates.Status{}, err
	}
	s := checker.Status()
	s.Supported = updatesSupported()
	if !s.Supported {
		s.Available, s.Notes = false, ""
	}
	return s, nil
}

func (a *App) CheckForUpdates(manual bool) (updates.Status, error) {
	a.mu.Lock()
	checker, err := a.updateCheckerLocked()
	if err != nil {
		a.mu.Unlock()
		return updates.Status{}, err
	}
	// Development builds never make automatic network requests.
	if !updatesSupported() || (!manual && a.development) {
		a.mu.Unlock()
		return a.GetUpdateStatus()
	}
	if a.updateRunning || checker.Busy() {
		a.mu.Unlock()
		return updates.Status{}, errors.New("an update is already in progress; use the Yap Update window")
	}
	ctx := a.updateContext
	if ctx == nil {
		ctx = context.Background()
	}
	a.updateRunning = true
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer func() {
		a.mu.Lock()
		a.updateRunning = false
		a.mu.Unlock()
	}()
	return checker.Check(ctx, manual), nil
}

func (a *App) InstallUpdate() error {
	a.mu.Lock()
	checker, err := a.updateCheckerLocked()
	if err != nil {
		a.mu.Unlock()
		return err
	}
	if !updatesSupported() || updateRepository == "" || a.development {
		a.mu.Unlock()
		return errors.New("install updates from a packaged Windows or macOS build")
	}
	if a.updateRunning || checker.Busy() {
		a.mu.Unlock()
		return errors.New("an update is already in progress; use the Yap Update window")
	}
	a.updateRunning = true
	ctx := a.updateContext
	if ctx == nil {
		ctx = context.Background()
	}
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer func() {
		a.mu.Lock()
		a.updateRunning = false
		a.mu.Unlock()
	}()
	// Keep the context alive after staging: the native window uses it for
	// retries and Restart & Apply. Shutdown cancels it with the other workers.
	return checker.Install(ctx)
}

// RestartUpdate also lets users apply an already staged update after closing
// the native update window. Wails still owns the helper and normal quit flow.
func (a *App) RestartUpdate() error {
	a.mu.Lock()
	checker, err := a.updateCheckerLocked()
	if err != nil {
		a.mu.Unlock()
		return err
	}
	if !updatesSupported() || updateRepository == "" || a.development || a.updateRunning {
		a.mu.Unlock()
		return errors.New("an update is not ready to restart")
	}
	ctx := a.updateContext
	a.mu.Unlock()
	return checker.Restart(ctx)
}
