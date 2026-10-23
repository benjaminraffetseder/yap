package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
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
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	old := text.Defaults()
	var raw string
	err = tx.QueryRow("SELECT value FROM text_processing WHERE id=1").Scan(&raw)
	if err == nil {
		if err = json.Unmarshal([]byte(raw), &old); err != nil {
			return err
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	now := time.Now()
	recordItems := func(kind string, before, after map[string]string) error {
		for id, value := range after {
			if err := recordRevision(tx, kind, id, before[id], value, now); err != nil {
				return err
			}
		}
		for id, value := range before {
			if _, exists := after[id]; !exists {
				if err := recordRevision(tx, kind, id, value, "", now); err != nil {
					return err
				}
			}
		}
		return nil
	}
	prompts := func(items []text.Prompt) map[string]string {
		out := map[string]string{}
		for _, item := range items {
			data, _ := json.Marshal(item)
			out[item.ID] = string(data)
		}
		return out
	}
	chains := func(items []text.Chain) map[string]string {
		out := map[string]string{}
		for _, item := range items {
			data, _ := json.Marshal(item)
			out[item.ID] = string(data)
		}
		return out
	}
	if err = recordItems("prompt", prompts(old.Prompts), prompts(v.Prompts)); err != nil {
		return err
	}
	if err = recordItems("chain", chains(old.Chains), chains(v.Chains)); err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO text_processing(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", string(data)); err != nil {
		return err
	}
	return tx.Commit()
}
