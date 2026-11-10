//go:build !windows && !darwin

package audio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Linux builds use the local FFmpeg input backend.
type Recorder struct {
	cmd    *exec.Cmd
	input  io.WriteCloser
	output *capturePCMWriter
	log    bytes.Buffer
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
	if r.cmd != nil {
		return errors.New("already recording")
	}
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
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err = Header(f, 0); err != nil {
		f.Close()
		return err
	}
	args := []string{"-hide_banner", "-loglevel", "error"}
	args = append(args, "-f", "pulse", "-i", source)
	args = append(args, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "s16le", "-flush_packets", "1", "pipe:1")
	r.log.Reset()
	cmd := exec.Command("ffmpeg", args...)
	output := &capturePCMWriter{file: f, level: level}
	cmd.Stdout, cmd.Stderr = output, &r.log
	cmd.WaitDelay = time.Second
	input, err := cmd.StdinPipe()
	if err != nil {
		f.Close()
		return err
	}
	if err = cmd.Start(); err != nil {
		input.Close()
		f.Close()
		return fmt.Errorf("microphone capture requires local FFmpeg: %w", err)
	}
	r.cmd, r.input, r.output = cmd, input, output
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
	// Wait joins FFmpeg's output copier before reading its sample count or
	// closing the WAV. Deliver the last partial meter buffer as well.
	r.output.flushLevel()
	finishErr := finish(r.output.file, r.output.count)
	if err != nil {
		return 0, errors.Join(fmt.Errorf("microphone capture failed: %w: %s", err, strings.TrimSpace(r.log.String())), finishErr)
	}
	if finishErr != nil {
		return 0, finishErr
	}
	if r.output.count == 0 {
		return 0, fmt.Errorf("no audio captured")
	}
	if r.output.count%2 != 0 {
		return 0, errors.New("microphone capture returned incomplete PCM audio")
	}
	return int64(r.output.count) * 1000 / 32000, nil
}

// Meter the same PCM16 samples saved to the recording. Fixed 100 ms buffers
// keep levels responsive and preserve sample alignment across pipe writes.
type capturePCMWriter struct {
	file  *os.File
	count uint32
	level func(float64)
	frame [3200]byte
	used  int
}

func (w *capturePCMWriter) Write(data []byte) (int, error) {
	n, err := w.file.Write(data)
	w.count += uint32(n)
	for data = data[:n]; len(data) > 0; {
		take := copy(w.frame[w.used:], data)
		w.used += take
		data = data[take:]
		if w.used == len(w.frame) {
			w.flushLevel()
		}
	}
	return n, err
}

func (w *capturePCMWriter) flushLevel() {
	if w.used > 0 && w.level != nil {
		w.level(Level(w.frame[:w.used]))
	}
	w.used = 0
}
