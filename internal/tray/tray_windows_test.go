package tray

import (
	"os"
	"testing"
	"time"
	"unsafe"
)

// Opt-in: shows a real tray icon but uses no microphone, clipboard, user data,
// global shortcut, or Explorer process restart.
func TestNativeTray(t *testing.T) {
	if os.Getenv("YAP_TRAY_SMOKE") != "1" {
		t.Skip("set YAP_TRAY_SMOKE=1 on an unlocked Windows desktop")
	}
	icon, err := os.ReadFile("../../build/windows/icon.ico")
	if err != nil {
		t.Fatal(err)
	}
	called := make(chan int, 8)
	controller, err := New(Actions{
		Show: func() { called <- showAction }, Record: func() { called <- recordAction },
		Cancel: func() { called <- cancelAction }, Quit: func() { called <- quitAction },
	}, icon)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(controller.Close)
	n := controller.(*native)
	hwnd := n.handle.Load()
	send := user.NewProc("SendMessageW")
	id := iconIdentifier{Size: uint32(unsafe.Sizeof(iconIdentifier{})), Window: hwnd, ID: iconID}
	var bounds rect
	assertIcon := func() {
		t.Helper()
		result, _, _ := iconRect.Call(uintptr(unsafe.Pointer(&id)), uintptr(unsafe.Pointer(&bounds)))
		if int32(result) < 0 {
			t.Fatalf("tray icon missing: HRESULT %x", result)
		}
	}
	callback := func(expected int) {
		t.Helper()
		select {
		case action := <-called:
			if action != expected {
				t.Fatalf("action %d, expected %d", action, expected)
			}
		case <-time.After(time.Second):
			t.Fatal("tray action did not run")
		}
	}
	assertIcon()
	// Production uses NOTIFYICON_VERSION_4 callback events, including keyboard
	// activation. Exercise the native message handler rather than calling actions.
	send.Call(hwnd, wmTray, 0, uintptr(iconID<<16|0x400))
	callback(showAction)
	send.Call(hwnd, wmTray, 0, uintptr(iconID<<16|0x401))
	callback(showAction)
	controller.Update(State{Phase: "idle", Ready: true})
	send.Call(hwnd, wmCommand, recordAction, 0)
	callback(recordAction)
	controller.Update(State{Phase: "recording", Ready: true})
	send.Call(hwnd, wmCommand, recordAction, 0)
	callback(recordAction)
	send.Call(hwnd, wmCommand, cancelAction, 0)
	callback(cancelAction)
	controller.Update(State{Phase: "transcribing", Ready: true})
	send.Call(hwnd, wmCommand, recordAction, 0)
	select {
	case <-called:
		t.Fatal("recording action enabled during transcription")
	case <-time.After(30 * time.Millisecond):
	}
	send.Call(hwnd, wmCommand, cancelAction, 0)
	callback(cancelAction)
	// Simulate just this icon being removed when Explorer recreates the taskbar.
	// Never restart the user's Explorer process.
	d := n.data()
	notifyIcon.Call(2, uintptr(unsafe.Pointer(&d)))
	send.Call(hwnd, uintptr(n.restart), 0, 0)
	assertIcon()
	send.Call(hwnd, wmCommand, quitAction, 0)
	callback(quitAction)
	controller.Close()
	if exists, _, _ := user.NewProc("IsWindow").Call(hwnd); exists != 0 {
		t.Fatal("tray window leaked on shutdown")
	}
	result, _, _ := iconRect.Call(uintptr(unsafe.Pointer(&id)), uintptr(unsafe.Pointer(&bounds)))
	if int32(result) >= 0 {
		t.Fatal("tray icon leaked on shutdown")
	}
	controller.Update(State{Phase: "recording"}) // safe after close
}

func TestInvalidTrayIcon(t *testing.T) {
	if controller, err := New(Actions{}, []byte("invalid")); controller != nil || err == nil {
		t.Fatal("invalid icon left a tray controller alive")
	}
}
