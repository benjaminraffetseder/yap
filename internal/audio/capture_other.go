//go:build !windows

package audio

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"time"
)

// Unix builds use the local FFmpeg input backend. Windows uses native waveIn.
type Recorder struct {
	cmd     *exec.Cmd
	input   io.WriteCloser
	started time.Time
	log     bytes.Buffer
	path    string
}

func New() Capture { return &Recorder{} }
func (r *Recorder) Start(path string, level func(float64)) error {
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	if runtime.GOOS == "darwin" {
		args = append(args, "-f", "avfoundation", "-i", ":0")
	} else {
		args = append(args, "-f", "pulse", "-i", "default")
	}
	args = append(args, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", path)
	r.log.Reset()
	r.cmd = exec.Command("ffmpeg", args...)
	r.cmd.Stderr = &r.log
	var err error
	r.input, err = r.cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err = r.cmd.Start(); err != nil {
		return fmt.Errorf("microphone capture requires local FFmpeg: %w", err)
	}
	r.started = time.Now()
	r.path = path
	return nil
}
func (r *Recorder) Stop() (int64, error) {
	if r.cmd == nil {
		return 0, fmt.Errorf("not recording")
	}
	io.WriteString(r.input, "q\n")
	r.input.Close()
	done := make(chan error, 1)
	go func() { done <- r.cmd.Wait() }()
	var err error
	select {
	case err = <-done:
	case <-time.After(5 * time.Second):
		r.cmd.Process.Kill()
		err = <-done
	}
	r.cmd = nil
	if err != nil {
		return 0, fmt.Errorf("microphone capture failed: %s", r.log.String())
	}
	info, err := os.Stat(r.path)
	if err != nil {
		return 0, err
	}
	if info.Size() < 44 {
		return 0, fmt.Errorf("no audio captured")
	}
	return time.Since(r.started).Milliseconds(), nil
}
