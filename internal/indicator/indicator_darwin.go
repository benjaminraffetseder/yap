//go:build darwin && cgo

package indicator

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit
#include <stdbool.h>
bool yap_indicator_configure(void *window);
bool yap_indicator_focused(void *window);
void yap_indicator_place(void *window, bool keepPosition);
bool yap_indicator_drag(void *window, int action, double x, double y);
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

func configureOptions(o *application.WebviewWindowOptions) {
	o.Width, o.Height = 376, 64
	o.Mac = application.MacWindow{
		WindowClass:        application.MacWindowClassPanel,
		PanelPreferences:   application.MacPanelPreferences{FloatingPanel: true, BecomesKeyOnlyIfNeeded: true, NonActivating: true},
		WindowLevel:        application.MacWindowLevelStatus,
		CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces | application.MacWindowCollectionBehaviorFullScreenAuxiliary | application.MacWindowCollectionBehaviorIgnoresCycle,
		CornerRadius:       12,
	}
}

type platformWindow struct {
	window                                  *application.WebviewWindow
	configured, positioned, dragging, moved bool
}

func newPlatformWindow(_ *application.App, window *application.WebviewWindow, _ string) *platformWindow {
	return &platformWindow{window: window}
}
func (p *platformWindow) configure() {
	if p.configured {
		return
	}
	p.positioned = bool(C.yap_indicator_configure(p.window.NativeWindow()))
	p.configured = true
}
func (p *platformWindow) focused() bool {
	return bool(C.yap_indicator_focused(p.window.NativeWindow()))
}
func (p *platformWindow) close() {}
func (p *platformWindow) place(reposition bool) {
	if !p.dragging {
		// Choose the mouse's screen on an initial placement only. Ordinary
		// refreshes clamp the current frame, even before the user's first drag.
		C.yap_indicator_place(p.window.NativeWindow(), C.bool(p.positioned || !reposition))
	}
}
func (p *platformWindow) drag(d pointerDrag) {
	switch d.Action {
	case "start":
		p.dragging, p.moved = true, false
		C.yap_indicator_drag(p.window.NativeWindow(), 0, C.double(d.X), C.double(d.Y))
	case "move":
		if p.dragging {
			if bool(C.yap_indicator_drag(p.window.NativeWindow(), 1, 0, 0)) {
				p.positioned, p.moved = true, true
			}
		}
	case "end":
		if p.dragging {
			p.dragging = false
			if p.moved {
				C.yap_indicator_drag(p.window.NativeWindow(), 2, 0, 0)
			}
		}
	}
}
