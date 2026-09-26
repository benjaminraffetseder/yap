package indicator

import (
	"os"
	"runtime"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

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
	})
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
		until := time.Now().Add(4 * time.Second)
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
	controller.Update(State{Phase: "transcribing"})
	wait("transcription status missing", func() bool { return visible() && text() == "Transcribing…" })
	if shown, _, _ := user.NewProc("IsWindowVisible").Call(n.stop); shown != 0 {
		t.Fatal("stop still visible during transcription")
	}
	click(n.cancel)
	callback("transcription cancel action missing", cancel)
	controller.Update(State{Phase: "error", Message: "test failure"})
	wait("error status missing", func() bool { return text() == "Dictation failed" })
	click(n.stop)
	callback("open app action missing", open)
	click(n.cancel)
	wait("dismiss failed", func() bool { return !visible() })
	controller.Update(State{Phase: "recording", StartedAt: time.Now().UnixMilli()})
	wait("new recording did not reappear", visible)
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
