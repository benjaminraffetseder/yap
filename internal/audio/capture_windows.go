package audio

import (
	"fmt"
	"os"
	"runtime"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var winmm = windows.NewLazySystemDLL("winmm.dll")
var waveOpen = winmm.NewProc("waveInOpen")
var wavePrepare = winmm.NewProc("waveInPrepareHeader")
var waveAdd = winmm.NewProc("waveInAddBuffer")
var waveStart = winmm.NewProc("waveInStart")
var waveReset = winmm.NewProc("waveInReset")
var waveUnprepare = winmm.NewProc("waveInUnprepareHeader")
var waveClose = winmm.NewProc("waveInClose")

type waveFormat struct {
	FormatTag, Channels                  uint16
	SamplesPerSec, BytesPerSec           uint32
	BlockAlign, BitsPerSample, ExtraSize uint16
}
type waveHeader struct {
	Data                        *byte
	BufferLength, BytesRecorded uint32
	User                        uintptr
	Flags, Loops                uint32
	Next, Reserved              uintptr
}
type Recorder struct {
	handle     uintptr
	headers    []*waveHeader
	buffers    [][]byte
	pins       runtime.Pinner
	file       *os.File
	stop, done chan struct{}
	count      uint32
	err        error
}

func New() Capture { return &Recorder{} }

//go:uintptrescapes
func mmCall(proc *windows.LazyProc, args ...uintptr) error {
	r, _, _ := proc.Call(args...)
	if r != 0 {
		return fmt.Errorf("microphone API %s failed (%d); check microphone permissions and device availability", proc.Name, r)
	}
	return nil
}
func (r *Recorder) Start(path, microphoneID string, level func(float64)) error {
	if r.handle != 0 {
		return fmt.Errorf("already recording")
	}
	device, err := waveDeviceIndex(microphoneID)
	if err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	r.file = f
	r.count = 0
	r.err = nil
	if err = Header(f, 0); err != nil {
		f.Close()
		return err
	}
	fmtPCM := waveFormat{FormatTag: 1, Channels: 1, SamplesPerSec: 16000, BytesPerSec: 32000, BlockAlign: 2, BitsPerSample: 16}
	if err = mmCall(waveOpen, uintptr(unsafe.Pointer(&r.handle)), device, uintptr(unsafe.Pointer(&fmtPCM)), 0, 0, 0); err != nil {
		f.Close()
		return err
	}
	for i := 0; i < 4; i++ {
		data := make([]byte, 4096)
		h := &waveHeader{Data: &data[0]}
		// The native driver retains both pointers until waveInUnprepareHeader.
		r.pins.Pin(h)
		r.pins.Pin(&data[0])
		r.buffers = append(r.buffers, data)
		h.BufferLength = 4096
		r.headers = append(r.headers, h)
		if err = mmCall(wavePrepare, r.handle, uintptr(unsafe.Pointer(h)), unsafe.Sizeof(*h)); err == nil {
			err = mmCall(waveAdd, r.handle, uintptr(unsafe.Pointer(h)), unsafe.Sizeof(*h))
		}
		if err != nil {
			r.cleanup()
			f.Close()
			return err
		}
	}
	if err = mmCall(waveStart, r.handle); err != nil {
		r.cleanup()
		f.Close()
		return err
	}
	r.stop = make(chan struct{})
	r.done = make(chan struct{})
	go r.pump(level)
	return nil
}
func (r *Recorder) drain(requeue bool, level func(float64)) {
	for i, h := range r.headers {
		if h.Flags&1 == 0 {
			continue
		}
		data := r.buffers[i][:int(h.BytesRecorded)]
		if r.err == nil {
			n, err := r.file.Write(data)
			r.count += uint32(n)
			r.err = err
			level(Level(data))
		}
		if requeue {
			if err := mmCall(waveAdd, r.handle, uintptr(unsafe.Pointer(h)), unsafe.Sizeof(*h)); err != nil && r.err == nil {
				r.err = err
			}
		}
	}
}
func (r *Recorder) pump(level func(float64)) {
	defer close(r.done)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			r.drain(true, level)
		case <-r.stop:
			return
		}
	}
}
func (r *Recorder) cleanup() {
	if r.handle != 0 {
		waveReset.Call(r.handle)
	}
	for _, h := range r.headers {
		waveUnprepare.Call(r.handle, uintptr(unsafe.Pointer(h)), unsafe.Sizeof(*h))
	}
	r.headers = nil
	r.buffers = nil
	if r.handle != 0 {
		waveClose.Call(r.handle)
		r.handle = 0
	}
	r.pins.Unpin()
}
func (r *Recorder) Stop() (int64, error) {
	if r.handle == 0 {
		return 0, fmt.Errorf("not recording")
	}
	close(r.stop)
	<-r.done
	if err := mmCall(waveReset, r.handle); err != nil && r.err == nil {
		r.err = err
	}
	r.drain(false, func(float64) {})
	r.cleanup()
	err := finish(r.file, r.count)
	if r.err != nil {
		err = r.err
	}
	return int64(r.count) * 1000 / 32000, err
}
