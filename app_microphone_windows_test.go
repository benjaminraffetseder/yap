package main

import (
	"errors"
	"testing"
	"yap/internal/audio"
)

func TestSaveMicrophoneAndRecoverToDefault(t *testing.T) {
	a := testApp(t)
	a.microphones = func() ([]audio.Device, error) {
		return []audio.Device{{ID: "usb-mic", Name: "USB microphone"}}, nil
	}
	next := a.settings
	next.MicrophoneID = "usb-mic"
	if err := a.SaveSettings(next); err != nil {
		t.Fatal(err)
	}
	stored, err := a.store.Settings()
	if err != nil || stored.MicrophoneID != "usb-mic" || a.settings.MicrophoneID != "usb-mic" {
		t.Fatalf("microphone choice was not saved: %+v %v", stored, err)
	}
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	next.MicrophoneID = ""
	if err := a.SaveSettings(next); err == nil {
		t.Fatal("changed microphone during recording")
	}
	if a.settings.MicrophoneID != "usb-mic" {
		t.Fatal("busy save changed input")
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	// Default recovery must work even if device enumeration fails.
	a.microphones = func() ([]audio.Device, error) { return nil, errors.New("enumeration failed") }
	if err := a.SaveSettings(next); err != nil {
		t.Fatal(err)
	}
	stored, err = a.store.Settings()
	if err != nil || stored.MicrophoneID != "" {
		t.Fatalf("default recovery failed: %+v %v", stored, err)
	}
}
