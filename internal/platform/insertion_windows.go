package platform

import (
	"fmt"
	"golang.org/x/sys/windows"
	"time"
	"unsafe"
)

var user32 = windows.NewLazySystemDLL("user32.dll")
var foreground = user32.NewProc("GetForegroundWindow")
var asyncKey = user32.NewProc("GetAsyncKeyState")
var sendInput = user32.NewProc("SendInput")

func Target() string { r, _, _ := foreground.Call(); return fmt.Sprintf("%d", r) }

type keyboardInput struct {
	Kind        uint32
	Pad         uint32
	VK, Scan    uint16
	Flags, Time uint32
	Extra       uintptr
	Tail        [8]byte
}

func Paste(target string) error {
	if target == "" || target == "0" {
		return fmt.Errorf("no target application; the transcript is on the clipboard")
	}
	// Do not send Ctrl+V while a shortcut modifier is held, or into a new window.
	deadline := time.Now().Add(3 * time.Second)
	for {
		held := false
		for _, key := range []uintptr{0x10, 0x11, 0x12, 0x5B, 0x5C} {
			v, _, _ := asyncKey.Call(key)
			held = held || v&0x8000 != 0
		}
		if !held {
			break
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("release the shortcut modifiers; the transcript is on the clipboard")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if Target() != target {
		return fmt.Errorf("focus changed; the transcript is on the clipboard")
	}
	inputs := []keyboardInput{{Kind: 1, VK: 0x11}, {Kind: 1, VK: 0x56}, {Kind: 1, VK: 0x56, Flags: 2}, {Kind: 1, VK: 0x11, Flags: 2}}
	n, _, err := sendInput.Call(uintptr(len(inputs)), uintptr(unsafe.Pointer(&inputs[0])), unsafe.Sizeof(inputs[0]))
	if n != uintptr(len(inputs)) {
		return fmt.Errorf("Windows blocked automatic paste: %v; paste from the clipboard", err)
	}
	return nil
}
