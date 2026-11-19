//go:build linux && cgo

package indicator

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"yap/internal/platform"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

var linuxIndicatorMain = make(chan func())

func TestMain(m *testing.M) {
	if os.Getenv("YAP_INDICATOR_SMOKE") != "1" {
		os.Exit(m.Run())
	}
	// GTK/Wails record the initial thread during package initialization.
	runtime.LockOSThread()
	done := make(chan int, 1)
	go func() { done <- m.Run() }()
	for {
		select {
		case run := <-linuxIndicatorMain:
			run()
		case code := <-done:
			os.Exit(code)
		}
	}
}

func TestLinuxIndicatorReportsMissingX11(t *testing.T) {
	t.Setenv("DISPLAY", "")
	if err := checkSupport(); err == nil {
		t.Fatal("desktop without X11/XWayland accepted")
	}
}

// Opt-in: loads the real Wails/WebKit indicator on X11 or GNOME Wayland with
// XWayland, without touching audio, shortcuts, clipboard, or application data.
func TestNativeIndicatorLinux(t *testing.T) {
	if os.Getenv("YAP_INDICATOR_SMOKE") != "1" {
		t.Skip("set YAP_INDICATOR_SMOKE=1 on an unlocked Linux desktop after building the frontend")
	}
	app := application.New(application.Options{
		Name:   "Yap indicator test",
		Linux:  application.LinuxOptions{DisableQuitOnLastWindowClosed: true},
		Assets: application.AssetOptions{Handler: application.AssetFileServerFS(os.DirFS(filepath.Join("..", "..", "frontend", "dist")))},
	})
	actions := make(chan string, 4)
	controller, err := New(app, Actions{
		Stop:   func(id string) { actions <- "stop:" + id },
		Cancel: func(id string) { actions <- "cancel:" + id },
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c := controller.(*wailsIndicator)
	w, _ := app.Window.GetByName(windowName)
	window := w.(*application.WebviewWindow)
	result := make(chan error, 1)
	app.OnShutdown(controller.Close)
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go func() {
			result <- exerciseNativeLinuxIndicator(c, window, actions)
			app.Quit()
		}()
	})
	timer := time.AfterFunc(20*time.Second, func() {
		select {
		case result <- fmt.Errorf("native Linux indicator test timed out"):
		default:
		}
		app.Quit()
	})
	defer timer.Stop()
	runResult := make(chan error, 1)
	linuxIndicatorMain <- func() { runResult <- app.Run() }
	if err := <-runResult; err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func exerciseNativeLinuxIndicator(c *wailsIndicator, window *application.WebviewWindow, actions <-chan string) error {
	defer c.Close()
	wait := func(description string, check func() bool) error {
		until := time.Now().Add(5 * time.Second)
		for !check() {
			if time.Now().After(until) {
				return fmt.Errorf("timed out: %s", description)
			}
			time.Sleep(20 * time.Millisecond)
		}
		return nil
	}
	if err := wait("frontend readiness", func() bool { c.mu.Lock(); defer c.mu.Unlock(); return c.ready }); err != nil {
		return err
	}
	before := platform.ActiveApplication()
	checkFocus := func(stage string) error {
		p := &platformWindow{window: window}
		if !application.InvokeSyncWithResult(p.nonActivating) {
			return fmt.Errorf("indicator lost its non-activating X11 properties after %s", stage)
		}
		if window.IsFocused() {
			return fmt.Errorf("indicator stole focus after %s", stage)
		}
		if after := platform.ActiveApplication(); before != "" && after != before {
			return fmt.Errorf("target focus changed after %s: %q -> %q", stage, before, after)
		}
		return nil
	}
	c.Update(State{SessionID: "linux-test", Phase: "recording", ProfileName: "Work", StartedAt: time.Now().Add(-65 * time.Second).UnixMilli()})
	if err := wait("recording indicator", window.IsVisible); err != nil {
		return err
	}
	if err := checkFocus("showing"); err != nil {
		return err
	}
	bounds := window.PhysicalBounds()
	if bounds.Width < 300 || bounds.Height < 35 || bounds.Height > 80 {
		return fmt.Errorf("unexpected indicator bounds: %+v", bounds)
	}
	if screen, err := window.GetScreen(); err != nil {
		return err
	} else if area := screen.PhysicalBounds; bounds.X < area.X || bounds.Y < area.Y || bounds.X+bounds.Width > area.X+area.Width || bounds.Y+bounds.Height > area.Y+area.Height {
		return fmt.Errorf("indicator placed offscreen: %+v (screen %+v)", bounds, area)
	}
	// Real WebKit event -> shared controller -> session-specific callback.
	for i, action := range []string{"primary", "secondary"} {
		window.ExecJS(`(function click(){const b=document.querySelector('#` + action + `');if(b&&b.getClientRects().length)b.click();else setTimeout(click,10)})()`)
		want := []string{"stop:linux-test", "cancel:linux-test"}[i]
		select {
		case got := <-actions:
			if got != want {
				return fmt.Errorf("indicator action %q, want %q", got, want)
			}
		case <-time.After(3 * time.Second):
			return fmt.Errorf("WebKit %s button did not reach Go", action)
		}
	}
	if err := checkFocus("controls"); err != nil {
		return err
	}
	c.Update(State{Phase: "transcribing", SessionID: "linux-test"})
	if err := wait("processing indicator", window.IsVisible); err != nil {
		return err
	}
	c.Update(State{Phase: "done", Warning: true})
	c.mu.Lock()
	revision := c.revision
	c.mu.Unlock()
	c.dispatch("secondary", revision)
	if err := wait("dismissal", func() bool { return !window.IsVisible() }); err != nil {
		return err
	}
	c.Update(State{Phase: "recording", SessionID: "second", StartedAt: time.Now().UnixMilli()})
	if err := wait("second recording indicator", window.IsVisible); err != nil {
		return err
	}
	if err := checkFocus("second recording"); err != nil {
		return err
	}
	c.Update(State{Phase: "idle"})
	return wait("idle hides indicator", func() bool { return !window.IsVisible() })
}
