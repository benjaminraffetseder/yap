package audio

import (
	"os"
	"strings"
	"testing"
)

func TestWaveDeviceChoiceSurvivesReordering(t *testing.T) {
	chosen := "usb-microphone"
	for _, index := range []uintptr{1, 0, 3} {
		inputs := []waveInput{
			{Device: Device{ID: "built-in", Name: "Microphone"}, index: 2},
			{Device: Device{ID: chosen, Name: "Microphone"}, index: index},
		}
		got, err := findWaveDevice(chosen, inputs)
		if err != nil || got != index {
			t.Fatalf("selected device changed after reordering: %d %v", got, err)
		}
	}
	if _, err := findWaveDevice(chosen, []waveInput{{Device: Device{ID: "built-in"}, index: 0}}); err == nil {
		t.Fatal("disconnected selection switched to another input")
	}
	if got, err := waveDeviceIndex(""); err != nil || got != 0xFFFFFFFF {
		t.Fatalf("default input no longer uses WAVE_MAPPER: %d %v", got, err)
	}
}

func TestMissingMicrophoneDoesNotCreateRecording(t *testing.T) {
	path := t.TempDir() + "/missing.wav"
	if err := New().Start(path, "nonexistent-yap-test-device", func(float64) {}); err == nil {
		t.Fatal("recording started with a missing microphone")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("failed device selection created a recording")
	}
}

// Read-only: lists real Windows inputs without opening or recording them.
func TestNativeMicrophoneEnumeration(t *testing.T) {
	devices, err := Devices()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, device := range devices {
		if device.ID == "" || strings.TrimSpace(device.Name) == "" || seen[device.ID] {
			t.Fatalf("unusable microphone identity: %+v", device)
		}
		seen[device.ID] = true
		index, err := waveDeviceIndex(device.ID)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("Input %d: %s", index, device.Name)
	}
}
