package audio

import (
	"bytes"
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fakeLinuxCaptureTools(t *testing.T, script string) {
	t.Helper()
	dir := t.TempDir()
	for name, contents := range map[string]string{
		"ffmpeg": "#!/bin/sh\n" + script,
		"pactl":  "#!/bin/sh\nprintf '%s' '[{\"name\":\"test.monitor\",\"description\":\"Monitor\"},{\"name\":\"test-mic\",\"description\":\"Microphone\"}]'\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestLinuxCaptureReportsSignalAndFinalizesWAV(t *testing.T) {
	fakeLinuxCaptureTools(t, `
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-i' ]; then
    shift
    [ "$1" = 'test-mic' ] || exit 2
  fi
  shift
done
n=0
while [ "$n" -lt 1600 ]; do
  printf '\000\040'
  n=$((n + 1))
done
read -r command
[ "$command" = q ] || exit 3
printf '\000\100'
`)
	devices, err := Devices()
	if err != nil || len(devices) != 1 || devices[0].ID != "test-mic" {
		t.Fatal("wrong microphone list", devices, err)
	}
	r := New()
	// Reusing the recorder must reset its sample count and level buffers.
	for range 2 {
		path := filepath.Join(t.TempDir(), "recording with spaces.wav")
		levels := make(chan float64, 16)
		if err := r.Start(path, "test-mic", func(level float64) { levels <- level }); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = r.Stop() })
		select {
		case level := <-levels:
			if level < .03 || level > 1 {
				t.Fatal("audio signal was reported as silence", level)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("captured audio did not reach the level callback")
		}
		duration, err := r.Stop()
		if err != nil || duration != 100 {
			t.Fatal("wrong captured duration", duration, err)
		}
		select {
		case level := <-levels:
			if level != 1 {
				t.Fatal("final sample did not reach the meter", level)
			}
		default:
			t.Fatal("last partial level buffer was discarded")
		}
		data, err := os.ReadFile(path)
		if err != nil || len(data) != 44+3202 || binary.LittleEndian.Uint32(data[40:]) != 3202 {
			t.Fatal("WAV was not finalized", len(data), err)
		}
		if !bytes.Equal(data[44:], append(bytes.Repeat([]byte{0, 32}, 1600), 0, 64)) {
			t.Fatal("captured samples were lost or reordered")
		}
		f, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		_, err = readWave(context.Background(), f, int64(len(data)))
		f.Close()
		if err != nil {
			t.Fatal("capture is not readable as PCM WAV", err)
		}
	}
}

func TestLinuxCaptureRejectsFailedAndEmptyInput(t *testing.T) {
	for _, tc := range []struct{ name, script, message string }{
		{"input failure", "printf 'PulseAudio access denied' >&2\nexit 1\n", "PulseAudio access denied"},
		{"empty input", "read -r command\n", "no audio captured"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fakeLinuxCaptureTools(t, tc.script)
			r := New()
			path := filepath.Join(t.TempDir(), "capture.wav")
			if err := r.Start(path, "", func(float64) {}); err != nil {
				t.Fatal(err)
			}
			if _, err := r.Stop(); err == nil || !strings.Contains(err.Error(), tc.message) {
				t.Fatal("capture failure was not reported", err)
			}
			if _, err := r.Stop(); err == nil {
				t.Fatal("failed capture remained active")
			}
		})
	}
}

func TestLinuxCaptureLevelsAcrossSplitSamples(t *testing.T) {
	f, err := os.Create(filepath.Join(t.TempDir(), "pcm"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var levels []float64
	w := &capturePCMWriter{file: f, level: func(level float64) { levels = append(levels, level) }}
	pcm := []byte{0, 32, 0, 16, 0, 64}
	for _, b := range pcm {
		if _, err := w.Write([]byte{b}); err != nil {
			t.Fatal(err)
		}
	}
	w.flushLevel()
	if len(levels) != 1 || levels[0] != Level(pcm) || w.count != uint32(len(pcm)) {
		t.Fatal("pipe boundaries changed PCM levels", levels, w.count)
	}
}

func TestLinuxMicrophoneCaptureIntegration(t *testing.T) {
	if os.Getenv("YAP_MICROPHONE_INTEGRATION") != "1" {
		t.Skip("set YAP_MICROPHONE_INTEGRATION=1 to record from the real microphone")
	}
	devices, err := Devices()
	if err != nil || len(devices) == 0 {
		t.Fatal("no microphone available", err)
	}
	for _, source := range []string{"", devices[0].ID} {
		t.Run(map[bool]string{true: "default", false: "selected"}[source == ""], func(t *testing.T) {
			r := New()
			path := filepath.Join(t.TempDir(), "microphone.wav")
			levels := make(chan float64, 128)
			if err := r.Start(path, source, func(level float64) {
				select {
				case levels <- level:
				default:
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _, _ = r.Stop() })
			time.Sleep(2 * time.Second)
			duration, err := r.Stop()
			if err != nil || duration <= 0 {
				t.Fatal("microphone did not capture audio", duration, err)
			}
			close(levels)
			var peak float64
			var updates int
			for level := range levels {
				updates++
				peak = max(peak, level)
			}
			if updates == 0 {
				t.Fatal("real microphone produced no level updates")
			}
			data, err := os.ReadFile(path)
			if err != nil || len(data) <= 44 || int64(len(data)-44)*1000/32000 != duration {
				t.Fatal("recording does not match captured duration", len(data), duration, err)
			}
			t.Logf("captured %d ms, %d level updates, peak %.3f", duration, updates, peak)
		})
	}
}
