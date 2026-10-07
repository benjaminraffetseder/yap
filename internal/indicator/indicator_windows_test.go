package indicator

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestNativeIndicatorFollowsForegroundWindowState(t *testing.T) {
	if os.Getenv("YAP_INDICATOR_SMOKE") != "1" {
		t.Skip("set YAP_INDICATOR_SMOKE=1 on an unlocked Windows desktop")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	host, _, err := createWindow.Call(exNoActivate|exToolWindow,
		uintptr(unsafe.Pointer(utf16("STATIC"))), uintptr(unsafe.Pointer(utf16("Yap focus test host"))),
		0x00CF0000, 0, 0, 320, 200, 0, 0, 0, 0)
	if host == 0 {
		t.Fatal(err)
	}
	defer destroyWindow.Call(host)
	showWindow.Call(host, 4)
	// Only foreground selection is controlled: visibility, minimization, process
	// ownership, the indicator window, and its timer/message loop use real Win32.
	// This avoids stealing the user's focus or relying on activation permission.
	var foreground atomic.Uintptr
	foreground.Store(host)
	controller, err := newNative(Actions{}, t.TempDir(), foreground.Load)
	if err != nil {
		t.Fatal(err)
	}
	defer controller.Close()
	hwnd := controller.(*native).handle.Load()
	visible := func() bool { result, _, _ := isWindowVisible.Call(hwnd); return result != 0 }
	wait := func(label string, check func() bool) {
		t.Helper()
		until := time.Now().Add(3 * time.Second)
		for !check() {
			if time.Now().After(until) {
				t.Fatal(label)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	controller.Update(State{Phase: "recording", StartedAt: time.Now().Add(-65 * time.Second).UnixMilli()})
	time.Sleep(150 * time.Millisecond)
	if visible() {
		t.Fatal("recording indicator visible over the focused app")
	}
	foreground.Store(0) // Another application has focus; the main window stays visible.
	wait("background app did not show the indicator", visible)
	foreground.Store(host)
	wait("returning focus did not hide the indicator", func() bool { return !visible() })
	showWindow.Call(host, 7) // Minimize without activating the indicator.
	wait("minimized recording did not show the indicator", visible)
	var text [128]uint16
	getWindowText.Call(controller.(*native).label, uintptr(unsafe.Pointer(&text[0])), uintptr(len(text)))
	if !strings.HasPrefix(windows.UTF16ToString(text[:]), "Recording  1:") {
		t.Fatal("focus change reset the recording timer")
	}
	showWindow.Call(host, 4)
	wait("returning to the app did not hide the indicator", func() bool { return !visible() })
	controller.Update(State{Phase: "transcribing"})
	time.Sleep(150 * time.Millisecond)
	if visible() {
		t.Fatal("processing indicator visible over the focused app")
	}
	showWindow.Call(host, 0) // Close-to-tray / hidden main window, with no state update.
	wait("hidden processing did not show the indicator", visible)
	showWindow.Call(host, 4)
	wait("restoring the app did not hide the indicator", func() bool { return !visible() })
	controller.Update(State{Phase: "done", Message: "Copied to clipboard"})
	time.Sleep(2800 * time.Millisecond)
	showWindow.Call(host, 0)
	time.Sleep(150 * time.Millisecond)
	if visible() {
		t.Fatal("focus change replayed an expired completion notification")
	}
}

// Opt-in because this test displays real desktop windows. It uses no microphone,
// clipboard, global shortcut, model, or user data.
func TestNativeIndicator(t *testing.T) {
	if os.Getenv("YAP_INDICATOR_SMOKE") != "1" {
		t.Skip("set YAP_INDICATOR_SMOKE=1 on an unlocked Windows desktop")
	}
	// Match the production executable's per-monitor-v2 manifest.
	user.NewProc("SetProcessDpiAwarenessContext").Call(signed(-4))
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	// A minimized test host models the Wails window. The indicator must be
	// independent of it, otherwise Windows hides owned windows on minimization.
	host, _, err := createWindow.Call(exNoActivate|exToolWindow,
		uintptr(unsafe.Pointer(utf16("STATIC"))), uintptr(unsafe.Pointer(utf16("Yap indicator test host"))),
		0x00CF0000, 0, 0, 320, 200, 0, 0, 0, 0)
	if host == 0 {
		t.Fatal(err)
	}
	defer destroyWindow.Call(host)
	showWindow.Call(host, 7) // SW_SHOWMINNOACTIVE
	if iconic, _, _ := user.NewProc("IsIconic").Call(host); iconic == 0 {
		t.Fatal("test host did not minimize")
	}
	foreground, _, _ := getForeground.Call()
	stop, cancel, open := make(chan struct{}, 1), make(chan struct{}, 1), make(chan struct{}, 1)
	controller, err := New(Actions{
		Stop:   func() { stop <- struct{}{} },
		Cancel: func() { cancel <- struct{}{} },
		Show:   func() { open <- struct{}{} },
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(controller.Close)
	n := controller.(*native)
	hwnd := n.handle.Load()
	visible := func() bool { result, _, _ := user.NewProc("IsWindowVisible").Call(hwnd); return result != 0 }
	text := func() string {
		var buffer [128]uint16
		user.NewProc("GetWindowTextW").Call(n.label, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
		return windows.UTF16ToString(buffer[:])
	}
	wait := func(label string, condition func() bool) {
		t.Helper()
		until := time.Now().Add(8 * time.Second)
		for !condition() {
			if time.Now().After(until) {
				t.Fatal(label)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	assertFocus := func() {
		t.Helper()
		if current, _, _ := getForeground.Call(); current != foreground {
			t.Fatal("indicator stole foreground focus")
		}
	}
	click := func(control uintptr) {
		// Exercise the real mouse handlers, including the native-button SetFocus
		// override; BM_CLICK alone would miss this regression.
		sendMessage.Call(control, 0x0201, 1, 5|(5<<16))
		sendMessage.Call(control, 0x0202, 0, 5|(5<<16))
	}
	callback := func(label string, channel <-chan struct{}) {
		t.Helper()
		select {
		case <-channel:
		case <-time.After(time.Second):
			t.Fatal(label)
		}
		assertFocus()
	}
	if visible() {
		t.Fatal("idle indicator should be hidden")
	}
	styles, _, _ := windowLongProc("GetWindowLong").Call(hwnd, signed(-20))
	if styles&(exNoActivate|exToolWindow|exTopmost) != exNoActivate|exToolWindow|exTopmost {
		t.Fatalf("incorrect window styles: %x", styles)
	}
	if owner, _, _ := user.NewProc("GetWindow").Call(hwnd, 4); owner != 0 {
		t.Fatal("indicator depends on main window visibility")
	}
	controller.Update(State{Phase: "recording", StartedAt: time.Now().Add(-65 * time.Second).UnixMilli()})
	controller.SetLevel(0.7)
	wait("recording indicator not visible", func() bool { return visible() && text() == "Recording  1:05" })
	assertFocus()
	var bounds rect
	user.NewProc("GetWindowRect").Call(hwnd, uintptr(unsafe.Pointer(&bounds)))
	dpi, _, _ := getDPI.Call(hwnd)
	if bounds.Right-bounds.Left != int32(348*int(dpi)/96) || bounds.Bottom-bounds.Top != int32(64*int(dpi)/96) {
		t.Fatalf("window dimensions do not match display scale: %+v, DPI %d", bounds, dpi)
	}
	windowBounds := func() rect {
		t.Helper()
		var r rect
		if ok, _, err := user.NewProc("GetWindowRect").Call(hwnd, uintptr(unsafe.Pointer(&r))); ok == 0 {
			t.Fatal(err)
		}
		return r
	}
	mousePoint := func(x, y int) uintptr { return uintptr(uint16(x)) | uintptr(uint16(y))<<16 }
	var labelBounds rect
	user.NewProc("GetWindowRect").Call(n.label, uintptr(unsafe.Pointer(&labelBounds)))
	if hit, _, _ := sendMessage.Call(n.label, 0x0084, 0, mousePoint(int(labelBounds.Left+5), int(labelBounds.Top+5))); int32(hit) != -1 {
		t.Fatal("label does not pass pointer hit testing to the drag surface")
	}
	// Drag the status area beyond its left edge without moving the user's cursor.
	// Signed client coordinates must work when the captured pointer leaves it.
	sendMessage.Call(hwnd, 0x0201, 1, mousePoint(40, 32))
	sendMessage.Call(hwnd, 0x0200, 1, mousePoint(-20, -48))
	sendMessage.Call(hwnd, 0x0202, 0, mousePoint(40, 32))
	dragged := windowBounds()
	if dragged.Left != bounds.Left-60 || dragged.Top != bounds.Top-80 || dragged.Right-dragged.Left != bounds.Right-bounds.Left {
		t.Fatalf("status area did not drag correctly: before %+v, after %+v", bounds, dragged)
	}
	assertFocus()
	// Mouse-up and interrupted capture must stop movement.
	sendMessage.Call(hwnd, 0x0200, 0, mousePoint(90, 32))
	if got := windowBounds(); got != dragged {
		t.Fatalf("indicator moved after mouse-up: %+v", got)
	}
	sendMessage.Call(hwnd, 0x0201, 1, mousePoint(40, 32))
	sendMessage.Call(hwnd, 0x001F, 0, 0) // WM_CANCELMODE
	sendMessage.Call(hwnd, 0x0200, 1, mousePoint(90, 32))
	if got := windowBounds(); got != dragged {
		t.Fatalf("indicator moved after drag cancellation: %+v", got)
	}
	sendMessage.Call(hwnd, 0x0201, 1, mousePoint(40, 32))
	sendMessage.Call(n.stop, 0x0201, 1, mousePoint(5, 5)) // Transfers capture to a button.
	sendMessage.Call(hwnd, 0x0200, 1, mousePoint(90, 32))
	sendMessage.Call(n.stop, 0x0202, 0, mousePoint(-1, -1)) // Outside: no button action.
	if got := windowBounds(); got != dragged {
		t.Fatalf("indicator moved after losing capture: %+v", got)
	}
	select {
	case <-stop:
		t.Fatal("drag triggered Stop")
	case <-cancel:
		t.Fatal("drag triggered Cancel")
	default:
	}
	if os.Getenv("YAP_INDICATOR_PREVIEW") == "1" {
		// Desktop inspectors commonly omit tool windows. Expose this test-only
		// preview in their window list without changing its non-activation policy.
		setWindowLong.Call(hwnd, signed(-20), (styles&^exToolWindow)|0x00040000)
		time.Sleep(45 * time.Second)
		setWindowLong.Call(hwnd, signed(-20), styles)
	}
	click(n.stop)
	callback("stop action missing", stop)
	click(n.cancel)
	callback("recording cancel action missing", cancel)
	if got := windowBounds(); got != dragged {
		t.Fatalf("button clicks moved the indicator: %+v", got)
	}
	controller.Update(State{Phase: "transcribing"})
	wait("transcription status missing", func() bool { return visible() && text() == "Transcribing…" })
	if got := windowBounds(); got != dragged {
		t.Fatalf("transcription reset the chosen position: %+v", got)
	}
	if shown, _, _ := user.NewProc("IsWindowVisible").Call(n.stop); shown != 0 {
		t.Fatal("stop still visible during transcription")
	}
	click(n.cancel)
	callback("transcription cancel action missing", cancel)
	failure := State{Phase: "error", Message: "test failure"}
	controller.Update(failure)
	wait("error status missing", func() bool { return text() == "Dictation failed" })
	click(n.stop)
	callback("open app action missing", open)
	click(n.cancel)
	wait("dismiss failed", func() bool { return !visible() })
	controller.Update(failure)
	wait("repeated error did not reappear after dismissal", visible)
	wait("error did not auto-hide", func() bool { return !visible() })
	controller.Update(failure)
	wait("repeated error did not reappear after expiry", visible)
	controller.Update(State{Phase: "recording", StartedAt: time.Now().UnixMilli()})
	wait("new recording did not reappear", func() bool { return visible() && text() == "Recording  0:00" })
	if got := windowBounds(); got != dragged {
		t.Fatalf("new recording reset the chosen position: %+v", got)
	}
	// Model a work-area change without changing the user's displays. The retained
	// position must be clamped so controls do not remain outside the usable area.
	monitor, _, _ := monitorFromWindow.Call(hwnd, 2)
	info := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	getMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info)))
	setWindowPos.Call(hwnd, 0, signed(int(info.Work.Left)-10), signed(int(info.Work.Top)-10), 0, 0, 0x0015)
	sendMessage.Call(hwnd, 0x001A, 0, 0) // WM_SETTINGCHANGE
	if got := windowBounds(); got.Left != info.Work.Left || got.Top != info.Work.Top {
		t.Fatalf("display change left the indicator outside the work area: %+v", got)
	}
	controller.Update(State{Phase: "done", Message: "Copied to clipboard"})
	wait("completion missing", func() bool { return visible() && text() == "Copied to clipboard" })
	wait("completion did not auto-hide", func() bool { return !visible() })
	assertFocus()
	controller.Close()
	if exists, _, _ := user.NewProc("IsWindow").Call(hwnd); exists != 0 {
		t.Fatal("window leaked on shutdown")
	}
	controller.Update(State{Phase: "recording"}) // harmless after close
}

func TestNativeIndicatorRestoresPosition(t *testing.T) {
	if os.Getenv("YAP_INDICATOR_SMOKE") != "1" {
		t.Skip("set YAP_INDICATOR_SMOKE=1 on an unlocked Windows desktop")
	}
	user.NewProc("SetProcessDpiAwarenessContext").Call(signed(-4))
	dir := t.TempDir()
	foreground, _, _ := getForeground.Call()
	open := func() (*native, rect) {
		t.Helper()
		controller, err := New(Actions{}, dir)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(controller.Close)
		n := controller.(*native)
		hwnd := n.handle.Load()
		if visible, _, _ := user.NewProc("IsWindowVisible").Call(hwnd); visible != 0 {
			t.Fatal("restored indicator became visible before recording")
		}
		n.Update(State{Phase: "recording", StartedAt: time.Now().UnixMilli()})
		until := time.Now().Add(3 * time.Second)
		for {
			if visible, _, _ := user.NewProc("IsWindowVisible").Call(hwnd); visible != 0 {
				break
			}
			if time.Now().After(until) {
				t.Fatal("indicator did not appear")
			}
			time.Sleep(10 * time.Millisecond)
		}
		// Synchronous UI message ensures that placement (including DPI resize)
		// completed before reading the window rectangle from another thread.
		sendMessage.Call(hwnd, 0x0000, 0, 0) // WM_NULL
		var bounds rect
		getWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&bounds)))
		return n, bounds
	}
	n, before := open()
	hwnd := n.handle.Load()
	mousePoint := func(x, y int) uintptr { return uintptr(uint16(x)) | uintptr(uint16(y))<<16 }
	sendMessage.Call(hwnd, 0x0201, 1, 10|(10<<16))
	sendMessage.Call(hwnd, 0x0200, 1, mousePoint(60, -70))
	sendMessage.Call(hwnd, 0x0202, 0, 10|(10<<16))
	var dragged rect
	getWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&dragged)))
	if dragged.Left != before.Left+50 || dragged.Top != before.Top-80 {
		t.Fatal("test drag did not move indicator")
	}
	path := filepath.Join(dir, "indicator-position.json")
	if position, exists, err := loadPosition(path); err != nil || !exists || position != (point{dragged.Left, dragged.Top}) {
		t.Fatalf("drag did not immediately save position: %+v, %v", position, err)
	}
	n.Close()
	n, restored := open()
	if restored != dragged {
		t.Fatalf("restart lost position: saved %+v, restored %+v", dragged, restored)
	}
	n.Close()
	// An unplugged display can leave saved coordinates far outside today's
	// desktop. The recreated indicator must fit an available monitor instead.
	if err := savePosition(path, point{-1_000_000, -1_000_000}); err != nil {
		t.Fatal(err)
	}
	n, restored = open()
	monitor, _, _ := monitorFromWindow.Call(n.handle.Load(), 2)
	info := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	if ok, _, _ := getMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info))); ok == 0 {
		t.Fatal("monitor lookup failed")
	}
	if restored.Left < info.Work.Left || restored.Top < info.Work.Top || restored.Right > info.Work.Right || restored.Bottom > info.Work.Bottom {
		t.Fatalf("restored window is unreachable: %+v, work area %+v", restored, info.Work)
	}
	n.Close()
	if err := os.WriteFile(path, []byte(`{"x":"broken"}`), 0600); err != nil {
		t.Fatal(err)
	}
	n, _ = open() // Damaged geometry must not prevent a working indicator.
	n.Close()
	if current, _, _ := getForeground.Call(); current != foreground {
		t.Fatal("restoring position stole foreground focus")
	}
}
