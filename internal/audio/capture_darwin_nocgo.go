//go:build darwin && !cgo

package audio

import "errors"

type Recorder struct{}

func New() Capture { return &Recorder{} }
func (*Recorder) Start(string, string, func(float64)) error {
	return errors.New("macOS microphone capture requires a CGO-enabled build")
}
func (*Recorder) Stop() (int64, error) { return 0, errors.New("not recording") }

func Devices() ([]Device, error) {
	return nil, errors.New("macOS microphone selection requires a CGO-enabled build")
}
