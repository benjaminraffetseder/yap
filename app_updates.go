package main

import (
	"context"
	_ "embed"
	"errors"
	"path/filepath"
	goruntime "runtime"

	"yap/internal/updates"

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
		a.updateChecker = updates.New(appVersion(), updateRepository, filepath.Join(a.store.Dir, "update-check.json"))
	}
	return a.updateChecker, nil
}

func updatesSupported() bool {
	return goruntime.GOOS == "windows" && goruntime.GOARCH == "amd64"
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
		s.Available, s.DownloadURL, s.Notes = false, "", ""
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
	if a.updateCancel != nil {
		a.mu.Unlock()
		return updates.Status{}, errors.New("an update check is already running")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithCancel(ctx)
	a.updateCancel = cancel
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer func() {
		cancel()
		a.mu.Lock()
		a.updateCancel = nil
		a.mu.Unlock()
	}()
	return checker.Check(ctx, manual), nil
}

func (a *App) OpenUpdateDownload() error {
	return a.openUpdateDownload(func(_ context.Context, url string) error { return a.desktop.Browser.OpenURL(url) })
}

func (a *App) openUpdateDownload(open func(context.Context, string) error) error {
	s, err := a.GetUpdateStatus()
	if err != nil {
		return err
	}
	if !s.Supported || !s.Available || s.DownloadURL == "" {
		return errors.New("no update download is available")
	}
	a.mu.Lock()
	ctx, closing := a.ctx, a.closing
	a.mu.Unlock()
	if closing {
		return errors.New("app is shutting down")
	}
	// Only the validated installer URL can reach the operating system browser.
	return open(ctx, s.DownloadURL)
}
