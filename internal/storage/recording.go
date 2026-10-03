package storage

import (
	"github.com/google/uuid"
	"os"
	"path/filepath"
)

// CreateRecording allocates an owned file without following redirected storage
// or replacing another recording. The caller owns its handle and cleanup.
func (s *Store) CreateRecording() (*os.File, string, error) {
	root, err := s.recordingRoot()
	if err != nil {
		return nil, "", err
	}
	defer root.Close()
	name := uuid.NewString() + ".wav"
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, "", err
	}
	return file, filepath.Join(s.Dir, "recordings", name), nil
}
