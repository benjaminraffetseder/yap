package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const RecentlyDeletedDays = 30

// Keep the recording, edits, outputs and audio together. Only the tombstone
// changes, and a repeated delete never restarts the recovery window.
func (s *Store) TrashSessions(ids []string, now time.Time) error {
	return s.changeDeletedSessions(ids, now, false)
}

func (s *Store) RestoreSessions(ids []string, now time.Time) error {
	return s.changeDeletedSessions(ids, now, true)
}

// Validate the whole selection before touching files. Missing entries are safe
// to retry after partial audio cleanup, but active History must never be purged.
func (s *Store) PermanentlyDeleteSessions(ids []string) (int, error) {
	if len(ids) == 0 || len(ids) > HistoryPageSize {
		return 0, errors.New("select 1–50 dictations")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			return 0, errors.New("select unique dictations")
		}
		seen[id] = true
		entry, err := s.sessionIncludingDeleted(id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return 0, err
		}
		if entry.DeletedAt == "" {
			return 0, errors.New("only dictations in Recently Deleted can be permanently deleted; refresh the list")
		}
	}
	return s.DeleteSessions(ids)
}

func (s *Store) changeDeletedSessions(ids []string, now time.Time, restore bool) error {
	if len(ids) == 0 || len(ids) > HistoryPageSize {
		return errors.New("select 1–50 dictations")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			return errors.New("select unique dictations")
		}
		seen[id] = true
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range ids {
		var created string
		if err := tx.QueryRow("SELECT created_at FROM recordings WHERE id=?", id).Scan(&created); err != nil {
			return errors.New("a selected dictation no longer exists; refresh History")
		}
		if restore {
			var deleted string
			if err := tx.QueryRow("SELECT deleted_at FROM deleted_recordings WHERE id=?", id).Scan(&deleted); err != nil {
				return errors.New("a selected dictation is no longer in Recently Deleted; refresh the list")
			}
			at, err := time.Parse(time.RFC3339Nano, deleted)
			if err != nil || !now.Before(at.Add(RecentlyDeletedDays*24*time.Hour)) {
				return errors.New("this dictation's 30-day recovery period has ended")
			}
			_, err = tx.Exec("DELETE FROM deleted_recordings WHERE id=?", id)
		} else {
			_, err = tx.Exec("INSERT INTO deleted_recordings(id,deleted_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING", id, now.UTC().Format(time.RFC3339Nano))
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Use the existing journaled audio deletion so cleanup remains retryable if a
// recording is locked or the app exits while removing expired entries.
func (s *Store) PruneRecentlyDeleted(now time.Time) (int, error) {
	rows, err := s.db.Query("SELECT id,deleted_at FROM deleted_recordings")
	if err != nil {
		return 0, err
	}
	ids := []string{}
	for rows.Next() {
		var id, deleted string
		if err := rows.Scan(&id, &deleted); err != nil {
			rows.Close()
			return 0, err
		}
		if at, err := time.Parse(time.RFC3339Nano, deleted); err == nil && !now.Before(at.Add(RecentlyDeletedDays*24*time.Hour)) {
			ids = append(ids, id)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	for i, id := range ids {
		if err := s.Delete(id); err != nil {
			return i, fmt.Errorf("Recently Deleted removed %d dictations; cleanup stopped: %w", i, err)
		}
	}
	return len(ids), nil
}
