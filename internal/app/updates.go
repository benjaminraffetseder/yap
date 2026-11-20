package app

import (
	"context"
	"errors"
	"path/filepath"

	"yap/internal/app/updating"
	"yap/internal/updates"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

func (a *App) ensureUpdatingLocked() error {
	if err := a.availableLocked(); err != nil {
		return err
	}
	if !a.updating.Initialized() {
		if a.desktop == nil {
			return errors.New("desktop updater unavailable")
		}
		a.updating.Initialize(a.ctx, updates.New(a.version, a.updateRepository, filepath.Join(a.store.Dir, "update-check.json"), a.desktop.Updater))
	}
	return nil
}

func updatesSupported() bool { return updating.Supported() }

func (a *App) configureUpdater(engine *updater.Updater) error {
	return updating.Configure(engine, a.version, a.updateRepository)
}

func (a *App) GetUpdateStatus() (updates.Status, error) {
	a.mu.Lock()
	if err := a.ensureUpdatingLocked(); err != nil {
		a.mu.Unlock()
		return updates.Status{}, err
	}
	read := a.updating.PrepareStatus()
	a.mu.Unlock()
	return read(), nil
}

func (a *App) CheckForUpdates(manual bool) (updates.Status, error) {
	a.mu.Lock()
	if err := a.ensureUpdatingLocked(); err != nil {
		a.mu.Unlock()
		return updates.Status{}, err
	}
	check, err := a.updating.BeginCheck(manual, a.development)
	if err != nil {
		a.mu.Unlock()
		return updates.Status{}, err
	}
	if check == nil {
		a.mu.Unlock()
		return a.GetUpdateStatus()
	}
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer a.finishUpdate()
	return check(), nil
}

func (a *App) InstallUpdate() error {
	a.mu.Lock()
	if err := a.ensureUpdatingLocked(); err != nil {
		a.mu.Unlock()
		return err
	}
	install, err := a.updating.BeginInstall(updating.Policy{Repository: a.updateRepository, Development: a.development}, func(_ context.Context, url string) error {
		return a.desktop.Browser.OpenURL(url)
	})
	if err != nil {
		a.mu.Unlock()
		return err
	}
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer a.finishUpdate()
	return install()
}

func (a *App) finishUpdate() {
	a.mu.Lock()
	a.updating.Finish()
	a.mu.Unlock()
}

func (a *App) RestartUpdate() error {
	a.mu.Lock()
	if err := a.ensureUpdatingLocked(); err != nil {
		a.mu.Unlock()
		return err
	}
	restart, err := a.updating.PrepareRestart(updating.Policy{Repository: a.updateRepository, Development: a.development})
	a.mu.Unlock()
	if err != nil {
		return err
	}
	return restart()
}
