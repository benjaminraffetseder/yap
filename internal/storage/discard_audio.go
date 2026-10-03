package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// DiscardAudio journals intentional disposal before deleting private audio.
// Older builds ignore the additive journal; retained History audio is protected.
func (s *Store) DiscardAudio(path string) error {
	if filepath.Dir(path) != filepath.Join(s.Dir, "recordings") {
		return errors.New("audio cleanup refused a path outside recordings")
	}
	var retained int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM recordings WHERE audio_path=?", path).Scan(&retained); err != nil {
		return err
	}
	if retained != 0 {
		return errors.New("audio cleanup refused a retained recording")
	}
	if _, err := s.db.Exec("INSERT OR IGNORE INTO discarded_audio(path) VALUES(?)", path); err != nil {
		return err
	}
	owned, err := s.ownedAudio(path)
	if err != nil {
		return err
	}
	if owned {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("audio cleanup pending for %s; close programs using it and retry or restart Yap: %w", path, err)
		}
	}
	_, err = s.db.Exec("DELETE FROM discarded_audio WHERE path=?", path)
	return err
}

func (s *Store) recoverDiscardedAudio() error {
	rows, err := s.db.Query("SELECT path FROM discarded_audio")
	if err != nil {
		return err
	}
	var paths []string
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			break
		}
		paths = append(paths, path)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	var result error
	for _, path := range paths {
		result = errors.Join(result, s.DiscardAudio(path))
	}
	return result
}
