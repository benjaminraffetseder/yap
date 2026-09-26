package indicator

import (
	"fmt"
	"math"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var user = windows.NewLazySystemDLL("user32.dll")
var gdi = windows.NewLazySystemDLL("gdi32.dll")
var registerClass = user.NewProc("RegisterClassExW")
var unregisterClass = user.NewProc("UnregisterClassW")
var createWindow = user.NewProc("CreateWindowExW")
var defWindow = user.NewProc("DefWindowProcW")
var destroyWindow = user.NewProc("DestroyWindow")
var getMessage = user.NewProc("GetMessageW")
var translateMessage = user.NewProc("TranslateMessage")
var dispatchMessage = user.NewProc("DispatchMessageW")
var postMessage = user.NewProc("PostMessageW")
var postQuit = user.NewProc("PostQuitMessage")
var showWindow = user.NewProc("ShowWindow")
var setWindowPos = user.NewProc("SetWindowPos")
var setWindowText = user.NewProc("SetWindowTextW")
var sendMessage = user.NewProc("SendMessageW")
var invalidate = user.NewProc("InvalidateRect")
var setTimer = user.NewProc("SetTimer")
var killTimer = user.NewProc("KillTimer")
var monitorFromWindow = user.NewProc("MonitorFromWindow")
var getMonitorInfo = user.NewProc("GetMonitorInfoW")
var getForeground = user.NewProc("GetForegroundWindow")
var getDPI = user.NewProc("GetDpiForWindow")
var beginPaint = user.NewProc("BeginPaint")
var endPaint = user.NewProc("EndPaint")
var fillRect = user.NewProc("FillRect")
var setWindowRgn = user.NewProc("SetWindowRgn")
var getClientRect = user.NewProc("GetClientRect")
var setCapture = user.NewProc("SetCapture")
var releaseCapture = user.NewProc("ReleaseCapture")
var callWindowProc = user.NewProc("CallWindowProcW")
var setWindowLong = windowLongProc("SetWindowLong")
var createBrush = gdi.NewProc("CreateSolidBrush")
var deleteObject = gdi.NewProc("DeleteObject")
var createFont = gdi.NewProc("CreateFontW")
var setTextColor = gdi.NewProc("SetTextColor")
var setBackgroundColor = gdi.NewProc("SetBkColor")
var createRegion = gdi.NewProc("CreateRoundRectRgn")
var loadCursor = user.NewProc("LoadCursorW")
var getWindowText = user.NewProc("GetWindowTextW")
var drawText = user.NewProc("DrawTextW")
var selectObject = gdi.NewProc("SelectObject")
var stockObject = gdi.NewProc("GetStockObject")
var roundRect = gdi.NewProc("RoundRect")
var backgroundMode = gdi.NewProc("SetBkMode")
var saveDC = gdi.NewProc("SaveDC")
var restoreDC = gdi.NewProc("RestoreDC")

const (
	wmUpdate     = 0x8001
	wmClose      = 0x0010
	wmCommand    = 0x0111
	stopID       = 101
	cancelID     = 102
	exNoActivate = 0x08000000
	exToolWindow = 0x00000080
	exTopmost    = 0x00000008
)

type rect struct{ Left, Top, Right, Bottom int32 }
type point struct{ X, Y int32 }
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
type monitorInfo struct {
	Size          uint32
	Monitor, Work rect
	Flags         uint32
}
type paintStruct struct {
	DC                 uintptr
	Erase              int32
	Paint              rect
	Restore, IncUpdate int32
	Reserved           [32]byte
}
type drawItem struct {
	ControlType, ControlID, ItemID, Action, State uint32
	Window, DC                                    uintptr
	Bounds                                        rect
	Data                                          uintptr
}

type native struct {
	mu      sync.Mutex
	state   State
	level   float64
	actions Actions
	handle  atomic.Uintptr
	closed  atomic.Bool
	done    chan struct{}
	// The remaining fields are used only by the window's OS thread.
	label, stop, cancel      uintptr
	background, accent, font uintptr
	button, pressed          uintptr
	dpi                      int
	last                     State
	hasLast                  bool
	visible                  bool
	placing                  bool
	looping                  bool
	dismissed                bool
	expires                  time.Time
	labelText                string
}

var classSequence atomic.Uint64

func windowLongProc(name string) *windows.LazyProc {
	if unsafe.Sizeof(uintptr(0)) == 8 {
		return user.NewProc(name + "PtrW")
	}
	return user.NewProc(name + "W")
}

func New(actions Actions) (Controller, error) {
	n := &native{actions: actions, done: make(chan struct{}), dpi: 96}
	ready := make(chan error, 1)
	go n.run(ready)
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
func (n *native) SetLevel(level float64) {
	if math.IsNaN(level) || math.IsInf(level, 0) {
		level = 0
	}
	n.mu.Lock()
	n.level = max(0, min(1, level))
	n.mu.Unlock()
}
func (n *native) Close() {
	if n.closed.CompareAndSwap(false, true) {
		if hwnd := n.handle.Load(); hwnd != 0 {
			postMessage.Call(hwnd, wmClose, 0, 0)
		}
	}
	<-n.done
}
func utf16(text string) *uint16 { p, _ := windows.UTF16PtrFromString(text); return p }
func signed(v int) uintptr      { return uintptr(int64(v)) }
func (n *native) px(v int) int  { return v * n.dpi / 96 }

func (n *native) run(ready chan<- error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer close(n.done)
	var module windows.Handle
	if err := windows.GetModuleHandleEx(windows.GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, nil, &module); err != nil {
		ready <- err
		return
	}
	className := utf16(fmt.Sprintf("YapIndicator%d", classSequence.Add(1)))
	wc := windowClass{Size: uint32(unsafe.Sizeof(windowClass{})), Procedure: windows.NewCallback(n.windowProc), Instance: uintptr(module), ClassName: className}
	wc.Cursor, _, _ = loadCursor.Call(0, 32512) // IDC_ARROW
	if result, _, err := registerClass.Call(uintptr(unsafe.Pointer(&wc))); result == 0 {
		ready <- fmt.Errorf("register indicator window: %w", err)
		return
	}
	defer unregisterClass.Call(uintptr(unsafe.Pointer(className)), uintptr(module))
	n.background, _, _ = createBrush.Call(0x00222222)
	n.accent, _, _ = createBrush.Call(0x0092C45C)
	n.button, _, _ = createBrush.Call(0x00383838)
	n.pressed, _, _ = createBrush.Call(0x00505050)
	defer deleteObject.Call(n.background)
	defer deleteObject.Call(n.accent)
	defer deleteObject.Call(n.button)
	defer deleteObject.Call(n.pressed)
	hwnd, _, err := createWindow.Call(exNoActivate|exToolWindow|exTopmost, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(utf16("Yap — Dictation status"))), 0x80000000, 0, 0, 348, 64, 0, 0, uintptr(module), 0)
	if hwnd == 0 {
		ready <- fmt.Errorf("create indicator window: %w", err)
		return
	}
	n.handle.Store(hwnd)
	defer func() {
		if remaining := n.handle.Load(); remaining != 0 {
			destroyWindow.Call(remaining)
		}
	}()
	n.label = n.child("STATIC", "", 0x50000000, 0, uintptr(module))
	n.stop = n.child("BUTTON", "Stop", 0x5000000B, stopID, uintptr(module)) // BS_OWNERDRAW
	n.cancel = n.child("BUTTON", "Cancel", 0x5000000B, cancelID, uintptr(module))
	if n.label == 0 || n.stop == 0 || n.cancel == 0 {
		destroyWindow.Call(hwnd)
		ready <- fmt.Errorf("create indicator controls failed")
		return
	}
	n.preventActivation(n.stop, stopID)
	n.preventActivation(n.cancel, cancelID)
	n.layout()
	if timer, _, err := setTimer.Call(hwnd, 1, 100, 0); timer == 0 {
		ready <- fmt.Errorf("start indicator timer: %w", err)
		deleteObject.Call(n.font)
		return
	}
	n.looping = true
	ready <- nil
	defer func() {
		if n.font != 0 {
			deleteObject.Call(n.font)
		}
	}()
	var msg message
	for {
		result, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) <= 0 {
			break
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
	n.looping = false
}

func (n *native) child(class, text string, style uint32, id, instance uintptr) uintptr {
	hwnd, _, _ := createWindow.Call(0, uintptr(unsafe.Pointer(utf16(class))), uintptr(unsafe.Pointer(utf16(text))), uintptr(style), 0, 0, 0, 0, n.handle.Load(), id, instance, 0)
	return hwnd
}

// Native buttons remain accessible, but mouse clicks must not call SetFocus.
func (n *native) preventActivation(hwnd, id uintptr) {
	var previous uintptr
	callback := windows.NewCallback(func(window uintptr, msg uint32, w, l uintptr) uintptr {
		switch msg {
		case 0x0021:
			return 3 // WM_MOUSEACTIVATE: MA_NOACTIVATE
		case 0x0201:
			setCapture.Call(window)
			sendMessage.Call(window, 0x00F3, 1, 0)
			return 0 // BM_SETSTATE
		case 0x0202:
			releaseCapture.Call()
			sendMessage.Call(window, 0x00F3, 0, 0)
			var bounds rect
			getClientRect.Call(window, uintptr(unsafe.Pointer(&bounds)))
			x, y := int32(int16(l&0xffff)), int32(int16((l>>16)&0xffff))
			if x >= 0 && x < bounds.Right && y >= 0 && y < bounds.Bottom {
				postMessage.Call(n.handle.Load(), wmCommand, id, window)
			}
			return 0
		}
		result, _, _ := callWindowProc.Call(previous, window, uintptr(msg), w, l)
		return result
	})
	previous, _, _ = setWindowLong.Call(hwnd, signed(-4), callback)
}

func (n *native) layout() {
	dpi, _, _ := getDPI.Call(n.handle.Load())
	if dpi > 0 {
		n.dpi = int(dpi)
	}
	if n.font != 0 {
		deleteObject.Call(n.font)
	}
	n.font, _, _ = createFont.Call(signed(-n.px(14)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(utf16("Segoe UI"))))
	for _, h := range []uintptr{n.label, n.stop, n.cancel} {
		sendMessage.Call(h, 0x0030, n.font, 1)
	}
	for _, p := range []struct {
		h            uintptr
		x, y, w, hgt int
	}{{n.label, 40, 21, 174, 22}, {n.stop, 216, 16, 58, 32}, {n.cancel, 280, 16, 58, 32}} {
		setWindowPos.Call(p.h, 0, signed(n.px(p.x)), signed(n.px(p.y)), uintptr(n.px(p.w)), uintptr(n.px(p.hgt)), 0x0014)
	}
	region, _, _ := createRegion.Call(0, 0, uintptr(n.px(348)+1), uintptr(n.px(64)+1), uintptr(n.px(16)), uintptr(n.px(16)))
	if region != 0 {
		if ok, _, _ := setWindowRgn.Call(n.handle.Load(), region, 1); ok == 0 {
			deleteObject.Call(region)
		}
	}
}

func (n *native) place() {
	foreground, _, _ := getForeground.Call()
	monitor, _, _ := monitorFromWindow.Call(foreground, 2)
	info := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	if ok, _, _ := getMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info))); ok == 0 {
		return
	}
	w, h := n.px(348), n.px(64)
	previousDPI := n.dpi
	x := int(info.Work.Left) + (int(info.Work.Right-info.Work.Left)-w)/2
	y := int(info.Work.Bottom) - h - n.px(24)
	// HWND_TOPMOST and SWP_NOACTIVATE keep the insertion target focused.
	n.placing = true
	setWindowPos.Call(n.handle.Load(), ^uintptr(0), signed(x), signed(y), uintptr(w), uintptr(h), 0x0050)
	n.placing = false
	n.visible = true
	// Moving to another monitor can deliver WM_DPICHANGED inside SetWindowPos.
	// Resize again after it returns so the controls fit the destination's scale.
	if previousDPI != n.dpi {
		n.place()
	}
}

func (n *native) refresh() {
	n.mu.Lock()
	s := n.state
	n.mu.Unlock()
	now := time.Now()
	v := presentation(s, now)
	if !n.hasLast || n.last != s {
		n.last = s
		n.hasLast = true
		n.dismissed = false
		n.expires = time.Time{}
		if v.dismissAfter > 0 {
			n.expires = now.Add(v.dismissAfter)
		}
		if v.visible && (!n.visible || s.Phase == "recording") {
			n.place()
		}
	}
	if !v.visible || n.dismissed || !n.expires.IsZero() && !now.Before(n.expires) {
		if n.visible {
			showWindow.Call(n.handle.Load(), 0)
			n.visible = false
		}
		return
	}
	if n.labelText != v.label {
		setWindowText.Call(n.label, uintptr(unsafe.Pointer(utf16(v.label))))
		n.labelText = v.label
	}
	if v.stop != "" {
		setWindowText.Call(n.stop, uintptr(unsafe.Pointer(utf16(v.stop))))
		showWindow.Call(n.stop, 4)
	} else {
		showWindow.Call(n.stop, 0)
	}
	setWindowText.Call(n.cancel, uintptr(unsafe.Pointer(utf16(v.cancel))))
	showWindow.Call(n.cancel, 4)
	invalidate.Call(n.handle.Load(), 0, 0)
}

func (n *native) windowProc(hwnd uintptr, msg uint32, w uintptr, l unsafe.Pointer) uintptr {
	switch msg {
	case wmUpdate, 0x0113:
		n.refresh()
		return 0 // WM_TIMER
	case 0x0021:
		return 3 // MA_NOACTIVATE
	case 0x0014:
		return 1 // WM_ERASEBKGND: paint the background once
	case 0x0138: // WM_CTLCOLORSTATIC
		setTextColor.Call(w, 0x00F0F0F0)
		setBackgroundColor.Call(w, 0x00222222)
		return n.background
	case 0x000F:
		n.paint(hwnd)
		return 0
	case 0x002B: // WM_DRAWITEM: styled native buttons retain accessibility names.
		n.drawButton((*drawItem)(l))
		return 1
	case 0x02E0: // WM_DPICHANGED
		n.layout()
		if n.visible && !n.placing {
			n.place()
		}
		return 0
	case 0x007E, 0x001A: // display/work-area changes
		if n.visible {
			n.place()
		}
		return 0
	case wmCommand:
		n.mu.Lock()
		s := n.state
		n.mu.Unlock()
		switch w & 0xffff {
		case stopID:
			if s.Phase == "recording" && n.actions.Stop != nil {
				go n.actions.Stop()
			} else if s.Phase == "error" && n.actions.Show != nil {
				go n.actions.Show()
			}
		case cancelID:
			if (s.Phase == "recording" || s.Phase == "transcribing") && n.actions.Cancel != nil {
				go n.actions.Cancel()
			} else {
				n.dismissed = true
				n.refresh()
			}
		}
		return 0
	case wmClose:
		killTimer.Call(hwnd, 1)
		destroyWindow.Call(hwnd)
		return 0
	case 0x0002:
		n.handle.Store(0)
		if n.looping {
			postQuit.Call(0)
		}
		return 0
	}
	result, _, _ := defWindow.Call(hwnd, uintptr(msg), w, uintptr(l))
	return result
}

func (n *native) drawButton(item *drawItem) {
	saved, _, _ := saveDC.Call(item.DC)
	defer restoreDC.Call(item.DC, saved)
	fillRect.Call(item.DC, uintptr(unsafe.Pointer(&item.Bounds)), n.background)
	brush := n.button
	if item.State&1 != 0 {
		brush = n.pressed
	} // ODS_SELECTED
	selectObject.Call(item.DC, brush)
	pen, _, _ := stockObject.Call(8) // NULL_PEN
	selectObject.Call(item.DC, pen)
	roundRect.Call(item.DC, signed(int(item.Bounds.Left)), signed(int(item.Bounds.Top)), signed(int(item.Bounds.Right)), signed(int(item.Bounds.Bottom)), uintptr(n.px(8)), uintptr(n.px(8)))
	selectObject.Call(item.DC, n.font)
	setTextColor.Call(item.DC, 0x00F0F0F0)
	backgroundMode.Call(item.DC, 1) // TRANSPARENT
	var text [32]uint16
	length, _, _ := getWindowText.Call(item.Window, uintptr(unsafe.Pointer(&text[0])), uintptr(len(text)))
	drawText.Call(item.DC, uintptr(unsafe.Pointer(&text[0])), length, uintptr(unsafe.Pointer(&item.Bounds)), 0x25) // center, vertical center, single line
}

func (n *native) paint(hwnd uintptr) {
	var ps paintStruct
	dc, _, _ := beginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if dc == 0 {
		return
	}
	defer endPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	bounds := rect{Right: int32(n.px(348)), Bottom: int32(n.px(64))}
	fillRect.Call(dc, uintptr(unsafe.Pointer(&bounds)), n.background)
	n.mu.Lock()
	level, s := n.level, n.state
	n.mu.Unlock()
	if s.Phase == "recording" || s.Phase == "transcribing" {
		for i := 0; i < 4; i++ {
			height := 4 + int(level*12)
			if s.Phase == "transcribing" {
				height = 5 + int((time.Now().UnixMilli()/150+int64(i))%4)*3
			}
			bar := rect{Left: int32(n.px(16 + i*4)), Top: int32(n.px(32 - height/2)), Right: int32(n.px(18 + i*4)), Bottom: int32(n.px(32 + height/2))}
			fillRect.Call(dc, uintptr(unsafe.Pointer(&bar)), n.accent)
		}
	} else {
		dot := rect{Left: int32(n.px(18)), Top: int32(n.px(28)), Right: int32(n.px(26)), Bottom: int32(n.px(36))}
		fillRect.Call(dc, uintptr(unsafe.Pointer(&dot)), n.accent)
	}
}
