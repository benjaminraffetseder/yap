package hotkey

import (
	"sync"
	"syscall"
	"unsafe"

	"golang.design/x/hotkey/internal/win"
)

type keyboardEdge struct{ down bool }
type keyboardEdges struct {
	key      uint32
	required uint8
	pressed  [256]bool
	held     bool
	pending  []keyboardEdge
}

var modifierKeys = []uint32{0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c}

func newKeyboardEdges(key uint32, required uint8) *keyboardEdges {
	s := &keyboardEdges{key: key, required: required}
	for _, k := range modifierKeys {
		s.pressed[k] = win.GetAsyncKeyState(int(k))&0x8000 != 0
	}
	return s
}

func (s *keyboardEdges) input(key uint32, down bool) {
	if key >= 256 {
		return
	}
	s.pressed[key] = down
	if key != s.key {
		return
	}
	if !down {
		if s.held {
			s.held = false
			s.pending = append(s.pending, keyboardEdge{false})
		}
		return
	}
	mods := uint8(0)
	if s.pressed[0xa0] || s.pressed[0xa1] {
		mods |= uint8(ModShift)
	}
	if s.pressed[0xa2] || s.pressed[0xa3] {
		mods |= uint8(ModCtrl)
	}
	if s.pressed[0xa4] || s.pressed[0xa5] {
		mods |= uint8(ModAlt)
	}
	if s.pressed[0x5b] || s.pressed[0x5c] {
		mods |= uint8(ModWin)
	}
	if !s.held && mods == s.required {
		s.held = true
		s.pending = append(s.pending, keyboardEdge{true})
	}
}

var (
	hookUser32       = syscall.NewLazyDLL("user32.dll")
	setKeyboardHook  = hookUser32.NewProc("SetWindowsHookExW")
	unhookKeyboard   = hookUser32.NewProc("UnhookWindowsHookEx")
	nextKeyboardHook = hookUser32.NewProc("CallNextHookEx")
	hookKernel32     = syscall.NewLazyDLL("kernel32.dll")
	hookThreadID     = hookKernel32.NewProc("GetCurrentThreadId")
	hookModule       = hookKernel32.NewProc("GetModuleHandleW")
	hookOwners       sync.Map
	// Reuse one callback for all registrations; NewCallback closures cannot be freed.
	keyboardCallback = syscall.NewCallback(func(code, message, data uintptr) uintptr {
		if int32(code) >= 0 {
			thread, _, _ := hookThreadID.Call()
			if value, ok := hookOwners.Load(thread); ok && data != 0 {
				owner := value.(*Hotkey)
				switch message {
				case 0x100, 0x104:
					owner.edges.input(*(*uint32)(unsafe.Pointer(data)), true)
				case 0x101, 0x105:
					owner.edges.input(*(*uint32)(unsafe.Pointer(data)), false)
				}
			}
		}
		result, _, _ := nextKeyboardHook.Call(0, code, message, data)
		return result
	})
)

func (hk *Hotkey) installKeyboardHook() (uintptr, error) {
	thread, _, _ := hookThreadID.Call()
	hookOwners.Store(thread, hk)
	module, _, _ := hookModule.Call(0)
	handle, _, err := setKeyboardHook.Call(13, keyboardCallback, module, 0)
	if handle == 0 {
		hookOwners.Delete(thread)
		return 0, err
	}
	return handle, nil
}

func (hk *Hotkey) removeKeyboardHook() {
	if hk.hook == 0 {
		return
	}
	unhookKeyboard.Call(hk.hook)
	hk.hook = 0
	thread, _, _ := hookThreadID.Call()
	hookOwners.Delete(thread)
	hk.edges = nil
}
