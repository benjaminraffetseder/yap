package indicator

import (
	"log"
	"math"
	"os"
	"path/filepath"
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
	"golang.org/x/sys/windows"
)

const exNoActivate = 0x08000000

type point struct{ X, Y int32 }

var (
	indicatorUser32   = windows.NewLazySystemDLL("user32.dll")
	isIconic          = indicatorUser32.NewProc("IsIconic")
	setWindowRegion   = indicatorUser32.NewProc("SetWindowRgn")
	createRoundRegion = windows.NewLazySystemDLL("gdi32.dll").NewProc("CreateRoundRectRgn")
	setWindowsHook    = indicatorUser32.NewProc("SetWindowsHookExW")
	unhookWindowsHook = indicatorUser32.NewProc("UnhookWindowsHookEx")
	callNextHook      = indicatorUser32.NewProc("CallNextHookEx")
	getAncestor       = indicatorUser32.NewProc("GetAncestor")
)

func WindowsOptions() application.WindowsOptions {
	return application.WindowsOptions{WndProcInterceptor: func(hwnd uintptr, msg uint32, _, _ uintptr) (uintptr, bool) {
		if msg == w32.WM_MOUSEACTIVATE && uint32(w32.GetWindowLong(hwnd, w32.GWL_EXSTYLE))&exNoActivate != 0 {
			return 3, true // MA_NOACTIVATE: buttons must leave the insertion target active.
		}
		return 0, false
	}}
}

func configureOptions(o *application.WebviewWindowOptions) {
	// Wails treats ExStyle as a replacement for its defaults, not extra flags.
	o.Windows = application.WindowsWindow{ExStyle: exNoActivate | w32.WS_EX_TOOLWINDOW | w32.WS_EX_TOPMOST, HiddenOnTaskbar: true, DisableFramelessWindowDecorations: true, DisableMenu: true}
}

type platformWindow struct {
	app                         *application.App
	window                      *application.WebviewWindow
	path                        string
	position                    point
	positioned, dragging, moved bool
	offset                      application.Point
	cursor                      func() (int, int, bool)
	clipSize                    application.Size
	clipDPI                     uint32
	activationHook              uintptr
}

func newPlatformWindow(app *application.App, window *application.WebviewWindow, dataDir string) *platformWindow {
	p := &platformWindow{app: app, window: window, cursor: w32.GetCursorPos}
	if dataDir != "" {
		p.path = filepath.Join(dataDir, "indicator-position.json")
	}
	var err error
	p.position, p.positioned, err = loadPosition(p.path)
	if err != nil {
		log.Printf("restore indicator position: %v", err)
	}
	return p
}

func (p *platformWindow) configure() {
	if p.activationHook == 0 {
		hwnd := uintptr(p.window.NativeWindow())
		// Wails Show uses SW_SHOW, which can activate an existing window even
		// with WS_EX_NOACTIVATE. Veto activation of this window on its UI thread;
		// leave the main window and every other application untouched.
		callback := syscall.NewCallback(func(code int32, target, data uintptr) uintptr {
			if code == 5 && target == hwnd {
				return 1
			} // HCBT_ACTIVATE
			if code == 9 { // HCBT_SETFOCUS, including the hosted WebView's child HWND.
				root, _, _ := getAncestor.Call(target, 2) // GA_ROOT
				if root == hwnd {
					return 1
				}
			}
			result, _, _ := callNextHook.Call(0, uintptr(code), target, data)
			return result
		})
		hook, _, err := setWindowsHook.Call(5, callback, 0, uintptr(w32.GetCurrentThreadId())) // WH_CBT
		if hook == 0 {
			log.Printf("protect indicator activation: %v", err)
		} else {
			p.activationHook = hook
		}
	}
	p.roundCorners()
}

func (p *platformWindow) close() {
	if p.activationHook != 0 {
		unhookWindowsHook.Call(p.activationHook)
		p.activationHook = 0
	}
}

func (p *platformWindow) roundCorners() {
	hwnd := uintptr(p.window.NativeWindow())
	if hwnd == 0 {
		return
	}
	bounds := p.window.PhysicalBounds()
	size := application.Size{Width: bounds.Width, Height: bounds.Height}
	dpi := uint32(w32.GetDpiForWindow(hwnd))
	if dpi == 0 {
		dpi = 96
	}
	if size.Width <= 0 || size.Height <= 0 || size == p.clipSize && dpi == p.clipDPI {
		return
	}
	// Clip the actual window, including its opaque webview background. A 12 DIP
	// radius matches the macOS panel without requiring Windows 11 decorations.
	diameter := (24*int(dpi) + 48) / 96
	region, _, err := createRoundRegion.Call(0, 0, uintptr(size.Width+1), uintptr(size.Height+1), uintptr(diameter), uintptr(diameter))
	if region == 0 {
		log.Printf("round indicator corners: %v", err)
		return
	}
	if result, _, err := setWindowRegion.Call(hwnd, region, 1); result == 0 {
		w32.DeleteObject(region)
		log.Printf("clip indicator window: %v", err)
		return
	}
	// Windows owns the region after SetWindowRgn succeeds and releases it when
	// replaced or when the window closes. Only rebuild it after size/DPI changes.
	p.clipSize, p.clipDPI = size, dpi
}

func (p *platformWindow) focused() bool {
	return appWindowFocused(w32.GetForegroundWindow(), uintptr(p.window.NativeWindow()))
}

func appWindowFocused(foreground, panel uintptr) bool {
	if foreground == 0 || foreground == panel {
		return false
	}
	_, pid := w32.GetWindowThreadProcessId(foreground)
	minimised, _, _ := isIconic.Call(foreground)
	return uint32(pid) == uint32(os.Getpid()) && w32.IsWindowVisible(foreground) && minimised == 0
}

func (p *platformWindow) place(reposition bool) {
	defer p.roundCorners()
	if p.dragging {
		return
	}
	bounds := p.window.PhysicalBounds()
	screen := p.app.Screen.ScreenNearestPhysicalRect(bounds)
	if p.positioned {
		screen = p.app.Screen.ScreenNearestPhysicalPoint(application.Point{X: int(p.position.X), Y: int(p.position.Y)})
	} else if reposition {
		if r := w32.GetWindowRect(w32.GetForegroundWindow()); r != nil {
			screen = p.app.Screen.ScreenNearestPhysicalRect(application.Rect{X: int(r.Left), Y: int(r.Top), Width: int(r.Right - r.Left), Height: int(r.Bottom - r.Top)})
		}
	}
	if screen == nil {
		return
	}
	area := screen.PhysicalWorkArea
	scale := float64(screen.ScaleFactor)
	bounds.Width = int(math.Round(316 * scale))
	bounds.Height = int(math.Round(40 * scale))
	if p.positioned {
		bounds.X = int(p.position.X)
		bounds.Y = int(p.position.Y)
	} else {
		bounds.X = area.X + (area.Width-bounds.Width)/2
		bounds.Y = area.Y + area.Height - bounds.Height - int(math.Round(24*scale))
	}
	bounds = clampBounds(bounds, area)
	if p.window.PhysicalBounds() != bounds {
		p.window.SetPhysicalBounds(bounds)
	}
}

func clampBounds(bounds, area application.Rect) application.Rect {
	bounds.X = max(area.X, min(bounds.X, area.X+max(0, area.Width-bounds.Width)))
	bounds.Y = max(area.Y, min(bounds.Y, area.Y+max(0, area.Height-bounds.Height)))
	return bounds
}

func (p *platformWindow) drag(d pointerDrag) {
	switch d.Action {
	case "start":
		bounds := p.window.PhysicalBounds()
		p.offset = application.Point{X: int(math.Round(d.X * float64(bounds.Width))), Y: int(math.Round(d.Y * float64(bounds.Height)))}
		p.dragging, p.moved = true, false
	case "move":
		if !p.dragging {
			return
		}
		x, y, ok := p.cursor()
		if !ok {
			return
		}
		bounds := p.window.PhysicalBounds()
		next := bounds
		next.X = x - p.offset.X
		next.Y = y - p.offset.Y
		if next != bounds {
			p.window.SetPhysicalBounds(next)
			p.roundCorners()
			p.moved = true
		}
	case "end":
		if !p.dragging {
			return
		}
		p.dragging = false
		if !p.moved {
			return
		}
		bounds := p.window.PhysicalBounds()
		p.position = point{X: int32(bounds.X), Y: int32(bounds.Y)}
		p.positioned = true
		p.place(false)
		bounds = p.window.PhysicalBounds()
		p.position = point{X: int32(bounds.X), Y: int32(bounds.Y)}
		if err := savePosition(p.path, p.position); err != nil {
			log.Printf("save indicator position: %v", err)
		}
	}
}
