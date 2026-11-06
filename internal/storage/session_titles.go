package storage

import (
	"database/sql"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Optional metadata lives outside the seven-column recordings table so older
// readers, inserts and deletes keep working during a rollback.
const sessionTitleColumn = "COALESCE((SELECT title FROM recording_titles WHERE id=r.id),'')"

func normalizeSessionTitle(value string) (string, error) {
	if !utf8.ValidString(value) || strings.IndexFunc(value, func(r rune) bool {
		return unicode.IsControl(r) || r == '\u2028' || r == '\u2029'
	}) >= 0 {
		return "", errors.New("use one line of valid text for a dictation title")
	}
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > 80 {
		return "", errors.New("use at most 80 characters for a dictation title")
	}
	return value, nil
}

func insertSessionTitle(tx *sql.Tx, id, title string) error {
	title, err := normalizeSessionTitle(title)
	if err != nil || title == "" {
		return err
	}
	_, err = tx.Exec("INSERT INTO recording_titles(id,title) VALUES(?,?)", id, title)
	return err
}

// Rename only active saved dictations; never alter their text, capture metadata,
// audio, outputs or transcript revisions. Empty text removes the optional title.
func (s *Store) SaveSessionTitle(id, title string) error {
	title, err := normalizeSessionTitle(title)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists int
	err = tx.QueryRow(`SELECT 1 FROM recordings WHERE id=? AND NOT EXISTS
		(SELECT 1 FROM deleted_recordings d WHERE d.id=recordings.id)`, id).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("this dictation no longer exists; refresh History")
	}
	if err != nil {
		return err
	}
	if title == "" {
		_, err = tx.Exec("DELETE FROM recording_titles WHERE id=?", id)
	} else {
		_, err = tx.Exec(`INSERT INTO recording_titles(id,title) VALUES(?,?)
			ON CONFLICT(id) DO UPDATE SET title=excluded.title`, id, title)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
