//go:build darwin && !cgo

package audio

import "errors"

type Recorder struct{}

func New() Capture { return &Recorder{} }
func (*Recorder) Start(string, func(float64)) error {
	return errors.New("macOS microphone capture requires a CGO-enabled build")
}
func (*Recorder) Stop() (int64, error) { return 0, errors.New("not recording") }
