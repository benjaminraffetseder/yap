//go:build darwin && cgo

package tray

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit
#include <stdint.h>
#include <stdlib.h>
void *yap_tray_new(uintptr_t callback);
void yap_tray_update(void *item, const char *status, const char *record, int record_enabled, int cancel_enabled, int recording);
void yap_tray_close(void *item);
*/
import "C"

import (
	"errors"
	"runtime/cgo"
	"sync"
	"unsafe"
)

type darwinTray struct {
	mu         sync.Mutex
	state      State
	actions    Actions
	closed     bool
	item       unsafe.Pointer
	handle     cgo.Handle
	updates    chan struct{}
	stop, done chan struct{}
}

func New(actions Actions, _ []byte) (Controller, error) {
	n := &darwinTray{actions: actions, updates: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
	n.handle = cgo.NewHandle(n)
	n.item = C.yap_tray_new(C.uintptr_t(n.handle))
	if n.item == nil {
		n.handle.Delete()
		return nil, errors.New("macOS application window is not available")
	}
	go func() {
		defer close(n.done)
		for {
			select {
			case <-n.stop:
				return
			case <-n.updates:
				n.render()
			}
		}
	}()
	return n, nil
}

func (n *darwinTray) Update(s State) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed || n.state == s {
		return
	}
	n.state = s
	select {
	case n.updates <- struct{}{}:
	default:
	}
}

func (n *darwinTray) render() {
	n.mu.Lock()
	s, closed := n.state, n.closed
	n.mu.Unlock()
	if closed {
		return
	}
	v := presentation(s)
	status, record := C.CString(v.status), C.CString(v.record)
	defer C.free(unsafe.Pointer(status))
	defer C.free(unsafe.Pointer(record))
	flag := func(value bool) C.int {
		if value {
			return 1
		}
		return 0
	}
	// Never hold a Go lock while synchronously dispatching to AppKit.
	C.yap_tray_update(n.item, status, record, flag(v.recordEnabled), flag(v.cancelEnabled), flag(s.Phase == "recording"))
}

func (n *darwinTray) Close() {
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
	C.yap_tray_close(n.item)
	n.handle.Delete()
}

//export yapTrayAction
func yapTrayAction(handle C.uintptr_t, id C.int) {
	n := cgo.Handle(handle).Value().(*darwinTray)
	n.mu.Lock()
	s, closed := n.state, n.closed
	n.mu.Unlock()
	if !closed {
		n.actions.dispatch(int(id), s)
	}
}
