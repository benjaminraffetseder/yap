package storage

import (
	"errors"
	"io"
	"path/filepath"
)

const maxPlaybackBytes = 20 * 1024 * 1024

func readAudioBytes(reader io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("audio file is too large")
	}
	return data, nil
}

// ReadAudio opens within owned storage once and bounds bytes actually consumed.
func (s *Store) ReadAudio(path string) ([]byte, error) {
	if path == "" {
		return nil, errors.New("audio was not retained")
	}
	if filepath.Dir(path) != filepath.Join(s.Dir, "recordings") {
		return nil, errors.New("invalid audio path")
	}
	root, err := s.recordingRoot()
	if err != nil {
		return nil, err
	}
	defer root.Close()
	name := filepath.Base(path)
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("audio is not a regular file")
	}
	f, err := openPlaybackFile(root, name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("audio is not a regular file")
	}
	if info.Size() > maxPlaybackBytes {
		return nil, errors.New("audio file is too large")
	}
	return readAudioBytes(f, maxPlaybackBytes)
}
