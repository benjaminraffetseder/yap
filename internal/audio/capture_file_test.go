package audio

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCaptureDestinationRemovesOnlyEmptyReservation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "capture.wav")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := removeEmptyCaptureReservation(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("AVFoundation output still exists", err)
	}
	if err := removeEmptyCaptureReservation(path); err != nil {
		t.Fatal("fresh capture path rejected", err)
	}
	if err := os.WriteFile(path, []byte("existing audio"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := removeEmptyCaptureReservation(path); err == nil {
		t.Fatal("existing audio removed")
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "existing audio" {
		t.Fatal("existing audio changed", err)
	}
	dir := t.TempDir()
	if err := removeEmptyCaptureReservation(dir); err == nil {
		t.Fatal("directory removed")
	}
}

func TestCaptureDestinationRejectsSymlinkReservation(t *testing.T) {
	outside := filepath.Join(t.TempDir(), "empty.wav")
	if err := os.WriteFile(outside, nil, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "capture.wav")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip("file symlink unavailable", err)
	}
	if err := removeEmptyCaptureReservation(link); err == nil {
		t.Fatal("capture followed symlink")
	}
	if _, err := os.Lstat(link); err != nil {
		t.Fatal("capture removed symlink", err)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("capture changed external file", err)
	}
}
