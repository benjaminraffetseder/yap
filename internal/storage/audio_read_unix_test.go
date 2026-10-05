//go:build !windows

package storage

import (
	"golang.org/x/sys/unix"
	"path/filepath"
	"testing"
)

func TestPlaybackFIFOAndSymlinkAreRejected(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	path := filepath.Join(s.Dir, "recordings", "pipe.wav")
	if err = unix.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadAudio(path); err == nil {
		t.Fatal("FIFO accepted")
	}
	root, err := s.recordingRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	f, err := openPlaybackFile(root, "pipe.wav")
	if err != nil {
		t.Fatal(err)
	}
	f.Close() // O_NONBLOCK prevents a substituted FIFO from waiting for a writer.
	if err = unix.Symlink("pipe.wav", filepath.Join(s.Dir, "recordings", "link.wav")); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadAudio(filepath.Join(s.Dir, "recordings", "link.wav")); err == nil {
		t.Fatal("symlink accepted")
	}
}
