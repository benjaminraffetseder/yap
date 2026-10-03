package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiscardAudioProtectsRetainedAndExternalFiles(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	path := filepath.Join(s.Dir, "recordings", "keep.wav")
	if err = os.WriteFile(path, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = s.Add(Session{ID: "keep", AudioPath: path}); err != nil {
		t.Fatal(err)
	}
	if err = s.DiscardAudio(path); err == nil {
		t.Fatal("deleted retained audio")
	}
	outside := filepath.Join(t.TempDir(), "outside.wav")
	os.WriteFile(outside, []byte("outside"), 0600)
	if err = s.DiscardAudio(outside); err == nil {
		t.Fatal("deleted outside audio")
	}
	for _, p := range []string{path, outside} {
		if _, err = os.Stat(p); err != nil {
			t.Fatal(err)
		}
	}
	missing := filepath.Join(s.Dir, "recordings", "already-gone.wav")
	if err = s.DiscardAudio(missing); err != nil {
		t.Fatal(err)
	}
	if err = s.DiscardAudio(missing); err != nil {
		t.Fatal("retry not idempotent", err)
	}
}
