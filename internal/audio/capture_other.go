//go:build !windows && !darwin

package audio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Linux builds use the local FFmpeg input backend.
type Recorder struct {
	cmd     *exec.Cmd
	input   io.WriteCloser
	started time.Time
	log     bytes.Buffer
	path    string
}

func New() Capture { return &Recorder{} }
func Devices() ([]Device, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	raw, err := exec.CommandContext(ctx, "pactl", "-f", "json", "list", "sources").Output()
	if err != nil {
		return nil, fmt.Errorf("listing microphones requires PulseAudio's pactl: %w", err)
	}
	var sources []struct {
		Name        string
		Description string
	}
	if err := json.Unmarshal(raw, &sources); err != nil {
		return nil, err
	}
	devices := make([]Device, 0, len(sources))
	for _, source := range sources {
		if !strings.HasSuffix(source.Name, ".monitor") {
			devices = append(devices, Device{ID: source.Name, Name: source.Description})
		}
	}
	return devices, nil
}

func (r *Recorder) Start(path, microphoneID string, level func(float64)) error {
	source := "default"
	if microphoneID != "" {
		devices, err := Devices()
		if err != nil {
			return err
		}
		found := false
		for _, device := range devices {
			if device.ID == microphoneID {
				source = device.ID
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("selected microphone is disconnected; choose another microphone in Settings")
		}
	}
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	args = append(args, "-f", "pulse", "-i", source)
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
