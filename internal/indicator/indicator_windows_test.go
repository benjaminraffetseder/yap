package indicator

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/w32"
	"golang.org/x/sys/windows"
)

func TestClampIndicatorBounds(t *testing.T) {
	area := application.Rect{X: -1920, Y: -500, Width: 1920, Height: 1040}
	for _, bounds := range []application.Rect{
		{X: -3000, Y: -1000, Width: 316, Height: 40},
		{X: 500, Y: 1000, Width: 316, Height: 40},
		{X: -1000, Y: 100, Width: 316, Height: 40},
	} {
		clamped := clampBounds(bounds, area)
		if clamped.X < area.X || clamped.Y < area.Y || clamped.X+clamped.Width > area.X+area.Width || clamped.Y+clamped.Height > area.Y+area.Height {
			t.Fatalf("offscreen: %+v", clamped)
		}
		if clamped.Width != bounds.Width || clamped.Height != bounds.Height {
			t.Fatal("clamping changed size")
		}
	}
}

// Opt-in integration test: loads the built indicator in a real Wails WebView2
// window with isolated geometry and no recording or application storage.
func TestNativeIndicator(t *testing.T) {
	if os.Getenv("YAP_INDICATOR_SMOKE") != "1" {
		t.Skip("set YAP_INDICATOR_SMOKE=1 on an unlocked Windows desktop after building the frontend")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED); err != nil {
		t.Fatal(err)
	}
	defer windows.CoUninitialize()
	app := application.New(application.Options{Name: "Yap indicator test", Windows: WindowsOptions(), Assets: application.AssetOptions{Handler: application.AssetFileServerFS(os.DirFS(filepath.Join("..", "..", "frontend", "dist")))}})
	dir := t.TempDir()
	actions := make(chan string, 4)
	controller, err := New(app, Actions{Stop: func() { actions <- "stop" }, Cancel: func() { actions <- "cancel" }}, dir)
	if err != nil {
		t.Fatal(err)
	}
	c := controller.(*wailsIndicator)
	w, _ := app.Window.GetByName(windowName)
	window := w.(*application.WebviewWindow)
	// Select foreground deterministically without moving the user's real focus.
	var foreground atomic.Uintptr
	c.focused = func() bool { return appWindowFocused(foreground.Load(), uintptr(window.NativeWindow())) }
	p := newPlatformWindow(app, window, dir)
	c.place, c.drag = p.place, p.drag
	result := make(chan error, 1)
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go func() {
			defer app.Quit()
			result <- exerciseNativeIndicator(app, c, window, p, &foreground, actions)
		}()
	})
	if err := app.Run(); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func exerciseNativeIndicator(app *application.App, c *wailsIndicator, window *application.WebviewWindow, p *platformWindow, foreground *atomic.Uintptr, actions <-chan string) error {
	defer c.Close()
	wait := func(description string, check func() bool) error {
		until := time.Now().Add(8 * time.Second)
		for !check() {
			if time.Now().After(until) {
				return fmt.Errorf("timed out: %s", description)
			}
			time.Sleep(20 * time.Millisecond)
		}
		return nil
	}
	if err := wait("frontend readiness handshake", func() bool { c.mu.Lock(); defer c.mu.Unlock(); return c.ready }); err != nil {
		return err
	}
	hwnd := uintptr(window.NativeWindow())
	visible := func() bool { return w32.IsWindowVisible(hwnd) }
	before := w32.GetForegroundWindow()
	c.Update(State{Phase: "recording", StartedAt: time.Now().Add(-65 * time.Second).UnixMilli()})
	if err := wait("recording window", visible); err != nil {
		return err
	}
	if err := checkRoundedWindow(hwnd, window.PhysicalBounds()); err != nil {
		return err
	}
	if before != w32.GetForegroundWindow() {
		return fmt.Errorf("showing indicator stole foreground focus")
	}
	if result := w32.SendMessage(hwnd, w32.WM_MOUSEACTIVATE, 0, 0); result != 3 {
		return fmt.Errorf("mouse activation result=%d, want MA_NOACTIVATE", result)
	}
	window.ExecJS(`document.querySelector('#primary').click()`)
	select {
	case action := <-actions:
		if action != "stop" {
			return fmt.Errorf("unexpected action %s", action)
		}
	case <-time.After(3 * time.Second):
		return fmt.Errorf("frontend Stop did not reach Go")
	}
	window.ExecJS(`document.querySelector('#secondary').click()`)
	select {
	case action := <-actions:
		if action != "cancel" {
			return fmt.Errorf("unexpected action %s", action)
		}
	case <-time.After(3 * time.Second):
		return fmt.Errorf("frontend Cancel did not reach Go")
	}
	// Exercise physical dragging and the existing JSON format without moving
	// the actual system cursor. Native bounds and persistence remain real.
	var original, moved application.Rect
	application.InvokeSync(func() {
		original = window.PhysicalBounds()
		x, y := original.X+20, original.Y+10
		p.cursor = func() (int, int, bool) { return x, y, true }
		p.drag(pointerDrag{Action: "start", X: 20 / float64(original.Width), Y: 10 / float64(original.Height)})
		x += 80
		y -= 60
		p.drag(pointerDrag{Action: "move"})
		p.drag(pointerDrag{Action: "end"})
		moved = window.PhysicalBounds()
	})
	if moved.X == original.X || moved.Y == original.Y {
		return fmt.Errorf("drag did not move the Wails window: %+v -> %+v", original, moved)
	}
	if err := checkRoundedWindow(hwnd, moved); err != nil {
		return err
	}
	if position, ok, err := loadPosition(p.path); err != nil || !ok || int(position.X) != moved.X || int(position.Y) != moved.Y {
		return fmt.Errorf("drag persistence failed: %+v, %t, %v", position, ok, err)
	}
	if before != w32.GetForegroundWindow() {
		return fmt.Errorf("indicator controls or dragging stole foreground focus")
	}
	// A real visible/minimised/hidden native Yap window controls suppression.
	var host uintptr
	application.InvokeSync(func() {
		host = w32.CreateWindowEx(exNoActivate|0x80, windows.StringToUTF16Ptr("STATIC"), windows.StringToUTF16Ptr("Yap indicator focus test"), 0x00CF0000, 0, 0, 320, 200, 0, 0, 0, nil)
		w32.ShowWindow(host, 4)
	})
	if host == 0 {
		return fmt.Errorf("could not create focus test window")
	}
	defer application.InvokeSync(func() { w32.DestroyWindow(host) })
	foreground.Store(host)
	if err := wait("focused Yap suppresses indicator", func() bool { return !visible() }); err != nil {
		return err
	}
	application.InvokeSync(func() { w32.ShowWindow(host, w32.SW_SHOWMINNOACTIVE) })
	if err := wait("minimised Yap retains indicator", visible); err != nil {
		return err
	}
	application.InvokeSync(func() { w32.ShowWindow(host, 4) })
	if err := wait("restored Yap hides indicator", func() bool { return !visible() }); err != nil {
		return err
	}
	c.Update(State{Phase: "done", Message: "Copied to clipboard"})
	time.Sleep(2700 * time.Millisecond)
	application.InvokeSync(func() { w32.ShowWindow(host, 0) })
	time.Sleep(200 * time.Millisecond)
	if visible() {
		return fmt.Errorf("hiding Yap replayed an expired completion")
	}
	c.Update(State{Phase: "transcribing"})
	if err := wait("hidden Yap retains processing indicator", visible); err != nil {
		return err
	}
	return nil
}

func checkRoundedWindow(hwnd uintptr, bounds application.Rect) error {
	gdi := windows.NewLazySystemDLL("gdi32.dll")
	region, _, err := gdi.NewProc("CreateRectRgn").Call(0, 0, 0, 0)
	if region == 0 {
		return fmt.Errorf("create test region: %v", err)
	}
	defer w32.DeleteObject(region)
	if kind, _, _ := windows.NewLazySystemDLL("user32.dll").NewProc("GetWindowRgn").Call(hwnd, region); kind != 3 {
		return fmt.Errorf("indicator has no rounded window region (type=%d)", kind)
	}
	for _, point := range []struct {
		x, y   int
		inside bool
	}{
		{0, 0, false}, {bounds.Width - 1, 0, false},
		{0, bounds.Height - 1, false}, {bounds.Width - 1, bounds.Height - 1, false},
		{bounds.Width / 2, 0, true}, {0, bounds.Height / 2, true},
		{bounds.Width - 1, bounds.Height / 2, true}, {bounds.Width / 2, bounds.Height - 1, true},
		{bounds.Width / 2, bounds.Height / 2, true},
	} {
		inside, _, _ := gdi.NewProc("PtInRegion").Call(region, uintptr(point.x), uintptr(point.y))
		if (inside != 0) != point.inside {
			return fmt.Errorf("window clipping at (%d,%d): inside=%t, want %t", point.x, point.y, inside != 0, point.inside)
		}
	}
	return nil
}
