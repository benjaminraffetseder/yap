//go:build darwin && cgo

package indicator

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit -framework QuartzCore
#include <stdint.h>
#include <stdlib.h>
void *yap_indicator_new(uintptr_t callback);
void yap_indicator_update(void *panel, const char *label, const char *stop, const char *cancel, int visible, int move, int working, double level);
void yap_indicator_close(void *panel);
*/
import "C"

import (
	"errors"
	"math"
	"runtime/cgo"
	"sync"
	"time"
	"unsafe"
)

type darwinIndicator struct {
	mu                sync.Mutex
	state             State
	level             float64
	actions           Actions
	closed, dismissed bool
	changed, visible  bool
	expires           time.Time
	panel             unsafe.Pointer
	handle            cgo.Handle
	stop, done        chan struct{}
}

// AppKit stores frame geometry in the app's user defaults.
func New(actions Actions, _ string) (Controller, error) {
	n := &darwinIndicator{actions: actions, stop: make(chan struct{}), done: make(chan struct{})}
	n.handle = cgo.NewHandle(n)
	n.panel = C.yap_indicator_new(C.uintptr_t(n.handle))
	if n.panel == nil {
		n.handle.Delete()
		return nil, errors.New("macOS application window is not available")
	}
	go func() {
		defer close(n.done)
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-n.stop:
				return
			case <-ticker.C:
				n.render()
			}
		}
	}()
	return n, nil
}

func (n *darwinIndicator) Update(s State) {
	n.mu.Lock()
	n.state = s
	n.changed = true // Repeated failed attempts must show a fresh notification.
	n.mu.Unlock()
}
func (n *darwinIndicator) SetLevel(level float64) {
	if math.IsNaN(level) || math.IsInf(level, 0) {
		level = 0
	}
	n.mu.Lock()
	n.level = max(0, min(1, level))
	n.mu.Unlock()
}
func (n *darwinIndicator) Close() {
	n.mu.Lock()
	if n.closed {
		n.mu.Unlock()
		<-n.done
		return
	}
	n.closed = true
	close(n.stop)
	n.mu.Unlock()
	<-n.done
	C.yap_indicator_close(n.panel)
	n.handle.Delete()
}

func (n *darwinIndicator) render() {
	n.mu.Lock()
	if n.closed {
		n.mu.Unlock()
		return
	}
	s, level := n.state, n.level
	now := time.Now()
	v := presentation(s, now)
	move := C.int(0)
	if n.changed {
		n.changed = false
		n.dismissed = false
		n.expires = time.Time{}
		if v.dismissAfter > 0 {
			n.expires = now.Add(v.dismissAfter)
		}
		if s.Phase == "recording" {
			move = 1
		}
	}
	visible := C.int(0)
	if v.visible && !n.dismissed && (n.expires.IsZero() || now.Before(n.expires)) {
		visible = 1
	}
	if visible == 0 && !n.visible {
		n.mu.Unlock()
		return // No main-queue calls or allocations while the indicator is hidden.
	}
	n.visible = visible != 0
	n.mu.Unlock() // Never hold a Go lock while waiting for AppKit's main queue.
	label, stop, cancel := C.CString(v.label), C.CString(v.stop), C.CString(v.cancel)
	defer C.free(unsafe.Pointer(label))
	defer C.free(unsafe.Pointer(stop))
	defer C.free(unsafe.Pointer(cancel))
	working := C.int(0)
	if s.Phase == "transcribing" {
		working = 1
	}
	C.yap_indicator_update(n.panel, label, stop, cancel, visible, move, working, C.double(level))
}

//export yapIndicatorAction
func yapIndicatorAction(handle C.uintptr_t, action C.int) {
	n := cgo.Handle(handle).Value().(*darwinIndicator)
	n.mu.Lock()
	if n.closed {
		n.mu.Unlock()
		return
	}
	s := n.state
	var callback func()
	if action == 1 {
		if s.Phase == "recording" {
			callback = n.actions.Stop
		} else if s.Phase == "error" {
			callback = n.actions.Show
		}
	} else if s.Phase == "recording" || s.Phase == "transcribing" {
		callback = n.actions.Cancel
	} else {
		n.dismissed = true
	}
	n.mu.Unlock()
	if callback != nil {
		go callback()
	}
}
