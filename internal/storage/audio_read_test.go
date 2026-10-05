package storage

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlaybackEnforcesActualReadBudget(t *testing.T) {
	// The second reader models bytes appended after a valid initial size check.
	if _, err := readAudioBytes(io.MultiReader(strings.NewReader("1234"), strings.NewReader("5")), 4); err == nil {
		t.Fatal("growing input exceeded budget")
	}
	if data, err := readAudioBytes(strings.NewReader("1234"), 4); err != nil || string(data) != "1234" {
		t.Fatal(string(data), err)
	}
}

func TestPlaybackRejectsUnownedNonregularAndOversizedAudio(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	file, path, err := s.CreateRecording()
	if err != nil {
		t.Fatal(err)
	}
	file.WriteString("audio")
	file.Close()
	if got, err := s.ReadAudio(path); err != nil || string(got) != "audio" {
		t.Fatal(string(got), err)
	}
	if _, err = s.ReadAudio(filepath.Dir(path)); err == nil {
		t.Fatal("directory accepted")
	}
	if _, err = s.ReadAudio(filepath.Join(t.TempDir(), "other.wav")); err == nil {
		t.Fatal("foreign path accepted")
	}
	f, _ := os.OpenFile(path, os.O_WRONLY, 0600)
	f.Truncate(maxPlaybackBytes + 1)
	f.Close()
	if _, err = s.ReadAudio(path); err == nil {
		t.Fatal("oversized audio accepted")
	}
	os.Remove(path)
	if _, err = s.ReadAudio(path); err == nil {
		t.Fatal("missing audio accepted")
	}
}
