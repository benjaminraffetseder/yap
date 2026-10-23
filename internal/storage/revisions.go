package storage

import (
	"database/sql"
	"errors"
	"time"
)

type Revision struct {
	ID        int64  `json:"id"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	Value     string `json:"value"`
}

// The baseline is immutable. Later saves in a ten-minute editing window share
// an entry, except restores, which retain the version being restored from.
func recordRevision(tx *sql.Tx, kind, itemID, before, after string, now time.Time) error {
	if before == after {
		return nil
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	var latest Revision
	err := tx.QueryRow(`SELECT id,created_at,updated_at,value FROM revisions WHERE kind=? AND item_id=? ORDER BY id DESC LIMIT 1`, kind, itemID).Scan(&latest.ID, &latest.CreatedAt, &latest.UpdatedAt, &latest.Value)
	first := errors.Is(err, sql.ErrNoRows)
	if err != nil && !first {
		return err
	}
	insert := func(value string) error {
		_, err := tx.Exec(`INSERT INTO revisions(kind,item_id,created_at,updated_at,value) VALUES(?,?,?,?,?)`, kind, itemID, stamp, stamp, value)
		return err
	}
	if first && before != "" {
		if err := insert(before); err != nil {
			return err
		}
	}
	if after == "" { // Deletions retain the last available content.
		return nil
	}
	var count, restoring int
	if err := tx.QueryRow(`SELECT COUNT(*),COALESCE(MAX(value=? AND id<>?),0) FROM revisions WHERE kind=? AND item_id=?`, after, latest.ID, kind, itemID).Scan(&count, &restoring); err != nil {
		return err
	}
	created, _ := time.Parse(time.RFC3339Nano, latest.CreatedAt)
	if !first && count > 1 && restoring == 0 && !now.Before(created) && now.Sub(created) < 10*time.Minute {
		_, err = tx.Exec(`UPDATE revisions SET value=?,updated_at=? WHERE id=?`, after, stamp, latest.ID)
	} else {
		err = insert(after)
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(`DELETE FROM revisions WHERE kind=? AND item_id=? AND id NOT IN (SELECT id FROM revisions WHERE kind=? AND item_id=? ORDER BY id DESC LIMIT 50)`, kind, itemID, kind, itemID)
	return err
}

func (s *Store) Revisions(kind, itemID string) ([]Revision, error) {
	switch kind {
	case "prompt", "chain", "transcript":
		if itemID == "" {
			return nil, errors.New("choose an item for version history")
		}
	case "vocabulary":
		if itemID != "" {
			return nil, errors.New("vocabulary history belongs to the whole list")
		}
	default:
		return nil, errors.New("unknown version history kind")
	}
	rows, err := s.db.Query(`SELECT id,created_at,updated_at,value FROM revisions WHERE kind=? AND item_id=? ORDER BY id DESC`, kind, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Revision{}
	for rows.Next() {
		var v Revision
		if err := rows.Scan(&v.ID, &v.CreatedAt, &v.UpdatedAt, &v.Value); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
