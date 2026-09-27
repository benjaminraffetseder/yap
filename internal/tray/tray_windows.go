package tray

import (
	"encoding/binary"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/windows"
)

var user = windows.NewLazySystemDLL("user32.dll")
var shell = windows.NewLazySystemDLL("shell32.dll")
var registerClass = user.NewProc("RegisterClassExW")
var unregisterClass = user.NewProc("UnregisterClassW")
var createWindow = user.NewProc("CreateWindowExW")
var destroyWindow = user.NewProc("DestroyWindow")
var defWindow = user.NewProc("DefWindowProcW")
var getMessage = user.NewProc("GetMessageW")
var translateMessage = user.NewProc("TranslateMessage")
var dispatchMessage = user.NewProc("DispatchMessageW")
var postMessage = user.NewProc("PostMessageW")
var postQuit = user.NewProc("PostQuitMessage")
var notifyIcon = shell.NewProc("Shell_NotifyIconW")
var iconRect = shell.NewProc("Shell_NotifyIconGetRect")

const (
	wmUpdate  = 0x8001
	wmTray    = 0x8002
	wmClose   = 0x0010
	wmCommand = 0x0111
	wmTimer   = 0x0113
	iconID    = 1
)

type point struct{ X, Y int32 }
type rect struct{ Left, Top, Right, Bottom int32 }
type message struct {
	Window         uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	Point          point
	Private        uint32
}
type windowClass struct {
	Size, Style                        uint32
	Procedure                          uintptr
	ClassExtra, WindowExtra            int32
	Instance, Icon, Cursor, Background uintptr
	MenuName, ClassName                *uint16
	SmallIcon                          uintptr
}
type iconData struct {
	Size               uint32
	Window             uintptr
	ID, Flags, Message uint32
	Icon               uintptr
	Tip                [128]uint16
	State, StateMask   uint32
	Info               [256]uint16
	Version            uint32
	InfoTitle          [64]uint16
	InfoFlags          uint32
	GUID               windows.GUID
	BalloonIcon        uintptr
}
type iconIdentifier struct {
	Size   uint32
	Window uintptr
	ID     uint32
	GUID   windows.GUID
}

type native struct {
	mu      sync.Mutex
	state   State
	actions Actions
	handle  atomic.Uintptr
	closed  atomic.Bool
	done    chan struct{}
	// Only the native message thread accesses these fields.
	icon    uintptr
	added   bool
	restart uint32
	looping bool
}

var classSequence atomic.Uint64

func utf16(s string) *uint16 { p, _ := windows.UTF16PtrFromString(s); return p }

func New(actions Actions, icon []byte) (Controller, error) {
	n := &native{actions: actions, done: make(chan struct{})}
	ready := make(chan error, 1)
	go n.run(ready, icon)
	if err := <-ready; err != nil {
		<-n.done
		return nil, err
	}
	return n, nil
}

func (n *native) Update(s State) {
	if n.closed.Load() {
		return
	}
	n.mu.Lock()
	n.state = s
	n.mu.Unlock()
	if hwnd := n.handle.Load(); hwnd != 0 {
		postMessage.Call(hwnd, wmUpdate, 0, 0)
	}
}

func (n *native) Close() {
	if n.closed.CompareAndSwap(false, true) {
		if hwnd := n.handle.Load(); hwnd != 0 {
			postMessage.Call(hwnd, wmClose, 0, 0)
		}
	}
	<-n.done
}

func (n *native) snapshot() State {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.state
}

// The embedded application icon is also available in dev/test executables,
// whose PE resources don't contain the production icon.
func smallIcon(data []byte) (uintptr, error) {
	if len(data) < 6 || binary.LittleEndian.Uint16(data[2:]) != 1 {
		return 0, fmt.Errorf("invalid tray icon")
	}
	count := int(binary.LittleEndian.Uint16(data[4:]))
	best, distance := []byte(nil), 1000
	for i := 0; i < count && 6+(i+1)*16 <= len(data); i++ {
		entry := data[6+i*16 : 6+(i+1)*16]
		width := int(entry[0])
		if width == 0 {
			width = 256
		}
		length, offset := int(binary.LittleEndian.Uint32(entry[8:])), int(binary.LittleEndian.Uint32(entry[12:]))
		delta := width - 32
		if delta < 0 {
			delta = -delta
		}
		if length > 0 && offset >= 0 && offset <= len(data) && length <= len(data)-offset && delta < distance {
			best, distance = data[offset:offset+length], delta
		}
	}
	if len(best) == 0 {
		return 0, fmt.Errorf("tray icon has no usable image")
	}
	size, _, _ := user.NewProc("GetSystemMetrics").Call(49) // SM_CXSMICON
	if size == 0 {
		size = 16
	}
	icon, _, err := user.NewProc("CreateIconFromResourceEx").Call(uintptr(unsafe.Pointer(&best[0])), uintptr(len(best)), 1, 0x30000, size, size, 0)
	runtime.KeepAlive(data)
	if icon == 0 {
		return 0, fmt.Errorf("load tray icon: %w", err)
	}
	return icon, nil
}

func (n *native) run(ready chan<- error, icon []byte) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer close(n.done)
	var err error
	n.icon, err = smallIcon(icon)
	if err != nil {
		ready <- err
		return
	}
	defer user.NewProc("DestroyIcon").Call(n.icon)
	var module windows.Handle
	err = windows.GetModuleHandleEx(0, nil, &module)
	if err != nil {
		ready <- err
		return
	}
	name := utf16(fmt.Sprintf("YapTray%d", classSequence.Add(1)))
	wc := windowClass{Size: uint32(unsafe.Sizeof(windowClass{})), Procedure: windows.NewCallback(n.windowProc), Instance: uintptr(module), ClassName: name}
	if ok, _, err := registerClass.Call(uintptr(unsafe.Pointer(&wc))); ok == 0 {
		ready <- fmt.Errorf("register tray window: %w", err)
		return
	}
	defer unregisterClass.Call(uintptr(unsafe.Pointer(name)), uintptr(module))
	// A hidden top-level window receives TaskbarCreated after Explorer restarts.
	hwnd, _, err := createWindow.Call(0, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(utf16("Yap tray"))), 0, 0, 0, 0, 0, 0, 0, uintptr(module), 0)
	if hwnd == 0 {
		ready <- fmt.Errorf("create tray window: %w", err)
		return
	}
	n.handle.Store(hwnd)
	defer func() {
		if remaining := n.handle.Load(); remaining != 0 {
			destroyWindow.Call(remaining)
		}
	}()
	restart, _, _ := user.NewProc("RegisterWindowMessageW").Call(uintptr(unsafe.Pointer(utf16("TaskbarCreated"))))
	n.restart = uint32(restart)
	if err := n.add(); err != nil {
		ready <- err
		return
	}
	defer n.remove()
	ready <- nil
	n.looping = true
	defer func() { n.looping = false }()
	var msg message
	for {
		result, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) <= 0 {
			return
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func (n *native) data() iconData {
	d := iconData{Size: uint32(unsafe.Sizeof(iconData{})), Window: n.handle.Load(), ID: iconID, Flags: 1 | 2 | 4 | 0x80, Message: wmTray, Icon: n.icon}
	tip, _ := windows.UTF16FromString("Yap — " + presentation(n.snapshot()).status)
	copy(d.Tip[:], tip)
	return d
}

func (n *native) add() error {
	d := n.data()
	if ok, _, err := notifyIcon.Call(0, uintptr(unsafe.Pointer(&d))); ok == 0 {
		return fmt.Errorf("add notification icon: %w", err)
	}
	n.added = true
	d.Version = 4
	if ok, _, err := notifyIcon.Call(4, uintptr(unsafe.Pointer(&d))); ok == 0 {
		n.remove()
		return fmt.Errorf("configure notification icon: %w", err)
	}
	user.NewProc("KillTimer").Call(n.handle.Load(), 1)
	return nil
}

func (n *native) remove() {
	if n.added {
		d := n.data()
		notifyIcon.Call(2, uintptr(unsafe.Pointer(&d)))
		n.added = false
	}
}

func (n *native) popup() {
	menu, _, _ := user.NewProc("CreatePopupMenu").Call()
	if menu == 0 {
		return
	}
	defer user.NewProc("DestroyMenu").Call(menu)
	v := presentation(n.snapshot())
	appendItem := func(id int, label string, enabled bool) {
		flags := uintptr(0)
		if !enabled {
			flags = 1
		}
		user.NewProc("AppendMenuW").Call(menu, flags, uintptr(id), uintptr(unsafe.Pointer(utf16(label))))
	}
	separator := func() { user.NewProc("AppendMenuW").Call(menu, 0x800, 0, 0) }
	appendItem(0, v.status, false)
	separator()
	appendItem(showAction, "Open Yap", true)
	appendItem(recordAction, v.record, v.recordEnabled)
	appendItem(cancelAction, "Cancel", v.cancelEnabled)
	separator()
	appendItem(quitAction, "Quit Yap", true)
	var position point
	user.NewProc("GetCursorPos").Call(uintptr(unsafe.Pointer(&position)))
	id := iconIdentifier{Size: uint32(unsafe.Sizeof(iconIdentifier{})), Window: n.handle.Load(), ID: iconID}
	var bounds rect
	if result, _, _ := iconRect.Call(uintptr(unsafe.Pointer(&id)), uintptr(unsafe.Pointer(&bounds))); int32(result) >= 0 {
		position = point{bounds.Left, bounds.Bottom}
	}
	// Foreground ownership lets Windows dismiss the menu on an outside click.
	user.NewProc("SetForegroundWindow").Call(n.handle.Load())
	choice, _, _ := user.NewProc("TrackPopupMenu").Call(menu, 0x182, uintptr(position.X), uintptr(position.Y), 0, n.handle.Load(), 0)
	postMessage.Call(n.handle.Load(), 0, 0, 0)
	n.actions.dispatch(int(choice), n.snapshot())
}

func (n *native) windowProc(hwnd uintptr, msg uint32, w, l uintptr) uintptr {
	if msg == n.restart && n.restart != 0 || msg == wmTimer {
		n.added = false
		if n.add() != nil {
			user.NewProc("SetTimer").Call(hwnd, 1, 1000, 0)
		}
		return 0
	}
	switch msg {
	case wmUpdate:
		if n.added {
			d := n.data()
			notifyIcon.Call(1, uintptr(unsafe.Pointer(&d)))
		}
		return 0
	case wmTray:
		switch l & 0xffff {
		case 0x400, 0x401: // NIN_SELECT / NIN_KEYSELECT
			n.actions.dispatch(showAction, n.snapshot())
		case 0x007B: // WM_CONTEXTMENU, including keyboard invocation
			n.popup()
		}
		return 0
	case wmCommand:
		n.actions.dispatch(int(w&0xffff), n.snapshot())
		return 0
	case wmClose:
		n.remove()
		destroyWindow.Call(hwnd)
		return 0
	case 0x0002: // WM_DESTROY
		n.remove()
		n.handle.Store(0)
		if n.looping {
			postQuit.Call(0)
		}
		return 0
	}
	result, _, _ := defWindow.Call(hwnd, uintptr(msg), w, l)
	return result
}
