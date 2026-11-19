//go:build linux && cgo

package indicator

/*
#cgo LDFLAGS: -lX11 -lXext -lm
#include "indicator_linux.h"
*/
import "C"

import (
	"errors"
	"log"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func checkSupport() error {
	if !bool(C.yap_indicator_supported()) {
		return errors.New("Linux floating indicator needs X11 or XWayland; install XWayland and enable DISPLAY in your desktop session")
	}
	return nil
}

func configureOptions(o *application.WebviewWindowOptions) {
	// Only this small status view uses X11 on Wayland. The main window keeps
	// its original backend. Software WebKit rendering allows the display switch.
	o.Linux.WebviewGpuPolicy = application.WebviewGpuPolicyNever
}

type platformWindow struct {
	window                 *application.WebviewWindow
	path                   string
	position               point
	configured, positioned bool
}

func newPlatformWindow(_ *application.App, window *application.WebviewWindow, dataDir string) *platformWindow {
	p := &platformWindow{window: window}
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
	if p.configured {
		return
	}
	p.configured = bool(C.yap_indicator_configure(p.window.NativeWindow())) && p.nonActivating()
	if !p.configured {
		log.Print("could not configure the Linux floating indicator's X11 surface")
	}
}

func (p *platformWindow) nonActivating() bool {
	return bool(C.yap_indicator_safe(p.window.NativeWindow()))
}

func (p *platformWindow) focused() bool {
	return !p.configured || bool(C.yap_indicator_focused(p.window.NativeWindow()))
}

func (p *platformWindow) show() {
	// Wails Show calls gtk_window_present, which requests keyboard focus.
	// Map our unmanaged status window directly, preserving the dictation target.
	C.yap_indicator_show(p.window.NativeWindow())
}

func (p *platformWindow) close() {}

func (p *platformWindow) place(bool) {
	x, y := C.int(p.position.X), C.int(p.position.Y)
	C.yap_indicator_place(p.window.NativeWindow(), C.bool(p.positioned), &x, &y)
	p.position = point{X: int32(x), Y: int32(y)}
	p.positioned = true
}

func (p *platformWindow) drag(d pointerDrag) {
	action := map[string]int{"start": 0, "move": 1, "end": 2}[d.Action]
	var x, y C.int
	if bool(C.yap_indicator_drag(p.window.NativeWindow(), C.int(action), C.double(d.X), C.double(d.Y), &x, &y)) {
		p.position, p.positioned = point{X: int32(x), Y: int32(y)}, true
		if d.Action == "end" {
			if err := savePosition(p.path, p.position); err != nil {
				log.Printf("save indicator position: %v", err)
			}
		}
	}
}
