//go:build windows || darwin

package tray

import (
	"bytes"
	"errors"
	"fmt"
	"image/png"
	"runtime"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type wailsTray struct {
	mu      sync.Mutex
	state   State
	updated bool
	queued  bool
	closed  bool
	actions Actions

	menu                                    *application.Menu
	status, record, cancel, history         *application.MenuItem
	result, openHistory, settings, shortcut *application.MenuItem
	enqueue                                 func(func())
	refresh                                 func(State)
	destroy                                 func()
}

// New configures a Wails tray before App.Run starts its native resources.
func New(app *application.App, actions Actions, icon []byte) (Controller, error) {
	if app == nil {
		return nil, errors.New("system tray requires a Wails application")
	}
	if _, err := png.DecodeConfig(bytes.NewReader(icon)); err != nil {
		return nil, fmt.Errorf("invalid tray PNG: %w", err)
	}
	t := newWailsTray(actions, application.InvokeAsync)
	item := app.SystemTray.New().SetIcon(icon).SetMenu(t.menu)
	item.SetTooltip("Yap — Set up a speech model")
	if runtime.GOOS == "windows" {
		item.OnClick(func() { t.dispatch(showAction) })
		item.OnDoubleClick(func() { t.dispatch(showAction) })
	}
	// macOS uses Wails' default left-click menu. Right-click menus are native
	// on both platforms; the main window keeps its normal desktop position.
	t.refresh = func(s State) {
		t.menu.Update()
		item.SetTooltip("Yap — " + presentation(s).status)
	}
	t.destroy = func() {
		application.InvokeSync(func() {
			item.Destroy()
			t.menu.Destroy()
		})
	}
	return t, nil
}

func newWailsTray(actions Actions, enqueue func(func())) *wailsTray {
	t := &wailsTray{actions: actions, enqueue: enqueue, menu: application.NewMenu()}
	t.status = t.menu.Add("Set up a speech model").SetEnabled(false)
	t.menu.AddSeparator()
	t.menu.Add("Open Yap").OnClick(func(*application.Context) { t.dispatch(showAction) })
	t.record = t.menu.Add("Start recording").SetEnabled(false).
		OnClick(func(*application.Context) { t.dispatch(recordAction) })
	t.cancel = t.menu.Add("Cancel").SetEnabled(false).
		OnClick(func(*application.Context) { t.dispatch(cancelAction) })
	t.menu.AddSeparator()
	t.result = t.menu.Add("Latest result").SetEnabled(false).
		OnClick(func(*application.Context) { t.dispatch(resultAction) })
	t.openHistory = t.menu.Add("History").OnClick(func(*application.Context) { t.dispatch(openHistoryAction) })
	t.settings = t.menu.Add("Settings").OnClick(func(*application.Context) { t.dispatch(settingsAction) })
	t.shortcut = t.menu.Add("Fix shortcuts…").SetHidden(true).
		OnClick(func(*application.Context) { t.dispatch(shortcutAction) })
	t.menu.AddSeparator()
	t.history = t.menu.AddCheckbox("Save to history", false).
		OnClick(func(*application.Context) { t.dispatch(historyAction) })
	t.menu.AddSeparator()
	t.menu.Add("Quit Yap").OnClick(func(*application.Context) { t.dispatch(quitAction) })
	return t
}

func (t *wailsTray) Update(s State) {
	t.mu.Lock()
	if t.closed || t.updated && t.state == s {
		t.mu.Unlock()
		return
	}
	t.state, t.updated = s, true
	if t.queued {
		t.mu.Unlock()
		return
	}
	t.queued = true
	t.mu.Unlock()
	// Recording code may hold App.mu. Never wait for the UI thread here.
	t.enqueue(t.render)
}

func (t *wailsTray) render() {
	t.mu.Lock()
	s, closed := t.state, t.closed
	t.queued = false
	t.mu.Unlock()
	if closed {
		return
	}
	v := presentation(s)
	t.status.SetLabel(v.status)
	t.record.SetLabel(v.record).SetEnabled(v.recordEnabled)
	t.cancel.SetEnabled(v.cancelEnabled)
	t.history.SetChecked(s.SaveHistory).SetEnabled(s.Phase != "closing" && s.Phase != "backup" && !s.HistoryLocked)
	t.result.SetEnabled(s.ResultAvailable && !s.Busy && s.Phase != "closing")
	t.openHistory.SetEnabled(s.Phase != "closing")
	t.settings.SetEnabled(s.Phase != "closing")
	t.shortcut.SetHidden(!s.ShortcutUnavailable).SetEnabled(s.Phase != "closing")
	if t.refresh != nil {
		t.refresh(s)
	}
}

func (t *wailsTray) dispatch(id int) {
	t.mu.Lock()
	s, closed := t.state, t.closed
	t.mu.Unlock()
	if closed {
		return
	}
	// Revalidate against the latest state, even if the menu opened earlier.
	t.actions.dispatch(id, s)
	if id == historyAction {
		// Wails toggles checkboxes before invoking callbacks. Restore the saved
		// state if the action was rejected or while its asynchronous save runs.
		t.enqueue(t.render)
	}
}

func (t *wailsTray) Close() {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.closed = true
	t.mu.Unlock()
	// Queued renders observe closed and become no-ops. There is no worker to
	// wait for while Wails is shutting down on its main thread.
	if t.destroy != nil {
		t.destroy()
	}
}
