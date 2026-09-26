//go:build darwin && cgo

package audio

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AVFoundation -framework AVFAudio -framework CoreMedia -framework Foundation
#include <stdlib.h>
char *yap_capture_devices(char **error);
void *yap_capture_start(const char *path, const char *deviceID, char **error);
double yap_capture_level(void *capture);
double yap_capture_stop(void *capture, char **error);
*/
import "C"

import (
	"encoding/json"
	"errors"
	"os"
	"time"
	"unsafe"
)

type Recorder struct {
	capture    unsafe.Pointer
	stop, done chan struct{}
	path       string
}

func New() Capture { return &Recorder{} }

func Devices() ([]Device, error) {
	var failure *C.char
	raw := C.yap_capture_devices(&failure)
	if failure != nil {
		defer C.free(unsafe.Pointer(failure))
		return nil, errors.New(C.GoString(failure))
	}
	if raw == nil {
		return nil, errors.New("microphones could not be listed")
	}
	defer C.free(unsafe.Pointer(raw))
	devices := make([]Device, 0)
	err := json.Unmarshal([]byte(C.GoString(raw)), &devices)
	return devices, err
}

func (r *Recorder) Start(path, microphoneID string, level func(float64)) error {
	if r.capture != nil {
		return errors.New("already recording")
	}
	name := C.CString(path)
	defer C.free(unsafe.Pointer(name))
	device := C.CString(microphoneID)
	defer C.free(unsafe.Pointer(device))
	var failure *C.char
	r.capture = C.yap_capture_start(name, device, &failure)
	if failure != nil {
		defer C.free(unsafe.Pointer(failure))
		return errors.New(C.GoString(failure))
	}
	if r.capture == nil {
		return errors.New("microphone capture could not start")
	}
	r.path = path
	r.stop, r.done = make(chan struct{}), make(chan struct{})
	go func() {
		defer close(r.done)
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-r.stop:
				return
			case <-ticker.C:
				level(float64(C.yap_capture_level(r.capture)))
			}
		}
	}()
	return nil
}

func (r *Recorder) Stop() (int64, error) {
	if r.capture == nil {
		return 0, errors.New("not recording")
	}
	close(r.stop)
	<-r.done
	var failure *C.char
	duration := C.yap_capture_stop(r.capture, &failure)
	r.capture = nil
	if failure != nil {
		defer C.free(unsafe.Pointer(failure))
		return 0, errors.New(C.GoString(failure))
	}
	info, err := os.Stat(r.path)
	if err != nil {
		return 0, err
	}
	if info.Size() <= 44 {
		return 0, errors.New("no audio captured")
	}
	return int64(duration * 1000), nil
}
