package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// Missing audio and external paths never block transcript deletion. Existing
// app-owned audio must remain a regular file in the real recordings directory.
func (s *Store) ownedAudio(path string) (bool, error) {
	if path == "" || filepath.Dir(path) != filepath.Join(s.Dir, "recordings") {
		return false, nil
	}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	root, rootErr := filepath.EvalSymlinks(s.Dir)
	dir, dirErr := filepath.EvalSymlinks(filepath.Join(s.Dir, "recordings"))
	if rootErr != nil || dirErr != nil || dir != filepath.Join(root, "recordings") {
		return false, errors.New("recording storage is redirected or unavailable; audio was not removed")
	}
	if !info.Mode().IsRegular() {
		return false, errors.New("retained audio is not a regular file; remove it manually before deleting the dictation")
	}
	return true, nil
}

func (s *Store) Delete(id string) error {
	if err := s.RecoverPendingDeletes(); err != nil {
		return err
	}
	v, err := s.Session(id)
	if err != nil {
		return err
	}
	owned, err := s.ownedAudio(v.AudioPath)
	if err != nil {
		return err
	}
	if !owned {
		_, err = s.db.Exec("DELETE FROM recordings WHERE id=?", id)
		return err
	}
	stage := filepath.Join(s.Dir, "recordings", ".pending-delete-"+uuid.NewString())
	if _, err = os.Lstat(stage); !os.IsNotExist(err) {
		return errors.New("could not reserve a staging path for audio deletion")
	}
	// Durable before moving audio: recovery can identify only files we staged,
	// without guessing from directory contents or altering the recording schema.
	_, err = s.db.Exec("INSERT INTO pending_audio_deletions(id,original,staged) VALUES(?,?,?)", id, v.AudioPath, stage)
	if err != nil {
		return err
	}
	err = s.deleteAndStageAudio(id, v.AudioPath, stage)
	recoveryErr := s.RecoverPendingDeletes()
	if err != nil {
		return errors.Join(err, recoveryErr)
	}
	if recoveryErr != nil {
		return fmt.Errorf("transcript deleted; audio cleanup is pending: %w", recoveryErr)
	}
	return nil
}

func (s *Store) deleteAndStageAudio(id, original, stage string) error {
	conn, err := s.db.Conn(context.Background())
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(context.Background(), "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
		}
	}()
	if _, err = conn.ExecContext(context.Background(), "DELETE FROM recordings WHERE id=?", id); err != nil {
		return err
	}
	if err = os.Rename(original, stage); err != nil {
		return err
	}
	_, err = conn.ExecContext(context.Background(), "COMMIT")
	committed = err == nil
	return err
}

// Called at startup through retention cleanup (even when retention is off),
// and before deleting another entry. Errors preserve the journal for retry.
func (s *Store) RecoverPendingDeletes() error {
	if err := s.recoverDiscardedAudio(); err != nil {
		return err
	}
	rows, err := s.db.Query("SELECT id,original,staged FROM pending_audio_deletions")
	if err != nil {
		return err
	}
	type pending struct{ id, original, staged string }
	entries := []pending{}
	for rows.Next() {
		var p pending
		if err = rows.Scan(&p.id, &p.original, &p.staged); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, p := range entries {
		if filepath.Dir(p.original) != filepath.Join(s.Dir, "recordings") || filepath.Dir(p.staged) != filepath.Dir(p.original) || !strings.HasPrefix(filepath.Base(p.staged), ".pending-delete-") {
			return errors.New("invalid pending audio deletion; no files were changed")
		}
		if _, err = uuid.Parse(strings.TrimPrefix(filepath.Base(p.staged), ".pending-delete-")); err != nil {
			return errors.New("invalid staged audio name; no files were changed")
		}
		present, err := s.ownedAudio(p.staged)
		if err != nil {
			return err
		}
		if present {
			v, err := s.Session(p.id)
			if errors.Is(err, sql.ErrNoRows) {
				if err = os.Remove(p.staged); err != nil {
					return err
				}
			} else {
				if err != nil {
					return err
				}
				if v.AudioPath != p.original {
					return errors.New("recording changed during deletion; staged audio was preserved")
				}
				if _, err = os.Lstat(p.original); !os.IsNotExist(err) {
					return errors.New("cannot restore audio over an existing file; staged audio was preserved")
				}
				if err = os.Rename(p.staged, p.original); err != nil {
					return fmt.Errorf("restore retained audio: %w", err)
				}
			}
		}
		if _, err = s.db.Exec("DELETE FROM pending_audio_deletions WHERE id=?", p.id); err != nil {
			return err
		}
	}
	return nil
}
