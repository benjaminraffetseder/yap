package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"

	"yap/internal/indicator"
	"yap/internal/inference/speech"
	"yap/internal/platform"
	"yap/internal/tray"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing {
		return nil
	}
	a.ctx, a.lifecycleCancel = context.WithCancel(ctx)
	ctx = a.ctx
	a.development = a.desktop.Env.Info().Debug
	a.notify = func(topic string, data ...interface{}) { a.desktop.Event.Emit(topic, data...) }
	a.copyText = a.clipboardSetText
	a.copyTextContext = a.clipboardSetTextContext
	a.showWindow = func() { a.window.Show(); a.window.UnMinimise(); a.window.Focus() }
	a.hideWindow = func() { a.window.Hide() }
	a.quitApplication = a.desktop.Quit
	// Configure Wails-owned resources before Run starts them; creating a tray
	// after ApplicationStarted can race its native startup and menu setup.
	var err error
	a.tray, err = tray.New(a.desktop, tray.Actions{
		ToggleHistory: a.toggleHistory, Show: a.show, Record: a.trayRecord,
		Cancel: func() { _ = a.Cancel() }, Quit: a.quit,
		Result:      func() { a.openDesktopPage("/") },
		History:     func() { a.openDesktopPage("/history") },
		Settings:    func() { a.openDesktopPage("/settings") },
		FixShortcut: a.openShortcutSettings,
	}, a.icon)
	if err != nil {
		a.status.TrayError = "Background controls unavailable: " + err.Error()
	}
	a.closeToTray = a.tray != nil
	root, err := os.UserConfigDir()
	if err == nil {
		a.indicator, err = indicator.New(a.desktop, indicator.Actions{
			Stop: a.indicatorStop, Cancel: a.indicatorCancel, Show: func() { a.openDesktopPage("/") },
		}, filepath.Join(root, "yap"))
	}
	if err != nil {
		a.status.IndicatorError = "Floating indicator unavailable: " + err.Error()
	}
	if runtime.GOOS == "darwin" {
		// Wails' default reopens every hidden window, including an idle indicator.
		a.desktop.Event.RegisterApplicationEventHook(events.Mac.ApplicationShouldHandleReopen, func(e *application.ApplicationEvent) {
			e.Cancel()
			go a.show()
		})
	}
	// Native integrations must start after the platform event loop is available.
	a.desktop.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go a.startup(ctx)
	})
	return nil
}

// Explicit desktop actions may focus Yap; completion updates never do.
func (a *App) openDesktopPage(path string) {
	switch path {
	case "/", "/history", "/settings", "/settings?section=dictation&focus=shortcut", "/settings?section=dictation&focus=profile-cycle-shortcut":
	default:
		return
	}
	a.mu.Lock()
	if a.closing {
		a.mu.Unlock()
		return
	}
	a.windowRequested = true
	show, notify := a.showWindow, a.notify
	a.mu.Unlock()
	if notify != nil {
		notify("desktop:navigate", path)
	}
	if show != nil {
		show()
	}
}

func (a *App) ServiceShutdown() error {
	a.shutdown(a.ctx)
	platform.CloseClipboard()
	return nil
}

func (a *App) openShortcutSettings() {
	a.mu.Lock()
	profileOnly := a.status.ShortcutError == "" && a.status.ProfileShortcutError != ""
	a.mu.Unlock()
	field := "shortcut"
	if profileOnly {
		field = "profile-cycle-shortcut"
	}
	a.openDesktopPage("/settings?section=dictation&focus=" + field)
}

func (a *App) clipboardSetText(text string) error {
	return a.clipboardSetTextContext(a.ctx, text)
}

func (a *App) clipboardSetTextContext(ctx context.Context, text string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if handled, err := platform.SetClipboardContext(ctx, text); handled {
		return err
	}
	if !a.desktop.Clipboard.SetText(text) {
		return errors.New("could not copy text to the clipboard")
	}
	return nil
}

func (a *App) openFile(title, label, pattern string) (string, error) {
	return a.desktop.Dialog.OpenFile().SetTitle(title).AddFilter(label, pattern).
		AttachToWindow(a.window).PromptForSingleSelection()
}

func (a *App) saveFile(title, filename, label, pattern string) (string, error) {
	return a.desktop.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title: title, Filename: filename, CanCreateDirectories: true, Window: a.window,
		Filters: []application.FileFilter{{DisplayName: label, Pattern: pattern}},
	}).PromptForSingleSelection()
}

// SetIndicatorTheme receives the appearance already resolved by the webview,
// including changes to the system theme while Yap is in the background.
func (a *App) SetIndicatorTheme(dark bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.closing && a.indicator != nil {
		a.indicator.SetTheme(dark)
	}
}

func (a *App) show() {
	a.mu.Lock()
	a.windowRequested = true
	show, closing := a.showWindow, a.closing
	a.mu.Unlock()
	if !closing && show != nil {
		show()
	}
}

func (a *App) onDomReady(context.Context) {
	a.mu.Lock()
	a.domReady = true
	show := a.initialWindowLocked()
	a.mu.Unlock()
	if show != nil {
		show()
	}
}

// Wails creates the window hidden. Decide once both startup and the webview are
// ready, regardless of callback order. A second launch always opens the window.
func (a *App) initialWindowLocked() func() {
	if a.closing || !a.domReady || !a.startupComplete || a.initialWindowApplied {
		return nil
	}
	a.initialWindowApplied = true
	ready := a.store != nil && speech.Validate(speech.Options{Executable: a.settings.WhisperPath, Model: a.settings.ModelPath}) == nil
	background := a.settings.SetupComplete && a.settings.StartInTray && !a.development && a.tray != nil && ready && a.status.Phase != "error" && a.status.ShortcutError == "" && a.status.StartupError == ""
	if background && !a.windowRequested {
		return nil
	}
	return a.showWindow
}

func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.Lock()
	hide := a.hideWindow
	background := a.closeToTray && a.tray != nil && !a.quitRequested && !a.closing && hide != nil
	a.mu.Unlock()
	if background {
		hide()
		return true
	}
	// AppKit callbacks must be cleaned up while its main event loop still runs.
	a.shutdown(ctx)
	return false
}
