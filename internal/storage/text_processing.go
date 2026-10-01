package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"yap/internal/inference/text"
)

func (s *Store) TextProcessing() (text.Config, error) {
	out := text.Defaults()
	var raw string
	err := s.db.QueryRow("SELECT value FROM text_processing WHERE id=1").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal([]byte(raw), &out); err != nil {
		return out, err
	}
	return text.Normalize(out)
}

func (s *Store) SaveTextProcessing(v text.Config) error {
	v, err := text.Normalize(v)
	if err != nil {
		return err
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO text_processing(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", string(data))
	return err
}
