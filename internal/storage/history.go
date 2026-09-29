package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

const HistoryPageSize = 50

type HistoryPage struct {
	Entries  []Session `json:"entries"`
	Total    int       `json:"total"`
	Page     int       `json:"page"`
	PageSize int       `json:"pageSize"`
}

// Stream rather than loading all transcripts into memory. Go's Unicode case
// folding preserves the old search behavior beyond SQLite's ASCII-only lower().
func (s *Store) SearchHistory(query string, page int) (HistoryPage, error) {
	out := HistoryPage{Entries: []Session{}, Page: page, PageSize: HistoryPageSize}
	if page < 0 || page > 1000000 || len(query) > 1000 {
		return out, errors.New("invalid History search or page")
	}
	rows, err := s.db.Query(`SELECT r.id,r.created_at,r.duration_ms,r.transcript,r.model,r.language,r.audio_path,COALESCE(o.transcript,r.transcript)
		FROM recordings r LEFT JOIN recording_outputs o ON r.id=o.id ORDER BY r.created_at DESC,r.id DESC`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	query = strings.ToLower(query)
	for rows.Next() {
		var v Session
		if err := rows.Scan(&v.ID, &v.CreatedAt, &v.DurationMS, &v.RawTranscript, &v.SpeechModel, &v.Language, &v.AudioPath, &v.FinalTranscript); err != nil {
			return out, err
		}
		if query != "" && !strings.Contains(strings.ToLower(v.RawTranscript), query) && !strings.Contains(strings.ToLower(v.FinalTranscript), query) {
			continue
		}
		if out.Total >= page*HistoryPageSize && len(out.Entries) < HistoryPageSize {
			out.Entries = append(out.Entries, v)
		}
		out.Total++
	}
	return out, rows.Err()
}

// Resolve the entire selection before export. The app serializes reads and writes.
func (s *Store) SelectedSessions(ids []string) ([]Session, error) {
	if len(ids) == 0 || len(ids) > HistoryPageSize {
		return nil, errors.New("select 1–50 dictations")
	}
	seen, out := map[string]bool{}, []Session{}
	for _, id := range ids {
		if id == "" || seen[id] {
			return nil, errors.New("select unique dictations")
		}
		seen[id] = true
		v, err := s.Session(id)
		if err != nil {
			return nil, errors.New("a selected dictation no longer exists; refresh History")
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Store) DeleteSessions(ids []string) (int, error) {
	if len(ids) == 0 || len(ids) > HistoryPageSize {
		return 0, errors.New("select 1–50 dictations")
	}
	seen, entries := map[string]bool{}, []Session{}
	for _, id := range ids {
		if id == "" || seen[id] {
			return 0, errors.New("select unique dictations")
		}
		seen[id] = true
		v, err := s.Session(id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		} // Retry after a partial cleanup safely.
		if err != nil {
			return 0, err
		}
		entries = append(entries, v)
	}
	deleted := 0
	for _, entry := range entries {
		if err := s.Delete(entry.ID); err != nil {
			return deleted, fmt.Errorf("deleted %d of %d dictations; could not remove the next recording: %w", deleted, len(entries), err)
		}
		deleted++
	}
	return deleted, nil
}

func ValidRetention(days int) bool { return days == 0 || days == 7 || days == 30 || days == 90 }

// Parse times instead of comparing RFC3339 strings: legacy rows can use offsets
// or varying fractional precision. Malformed dates are preserved, never pruned.
func (s *Store) PruneHistory(days int, now time.Time) (int, error) {
	if !ValidRetention(days) {
		return 0, errors.New("choose forever, 7, 30, or 90 days for History retention")
	}
	if days == 0 {
		return 0, nil
	}
	rows, err := s.db.Query("SELECT id,created_at FROM recordings")
	if err != nil {
		return 0, err
	}
	cutoff := now.Add(-time.Duration(days) * 24 * time.Hour)
	ids := []string{}
	for rows.Next() {
		var id, created string
		if err := rows.Scan(&id, &created); err != nil {
			rows.Close()
			return 0, err
		}
		if at, err := time.Parse(time.RFC3339Nano, created); err == nil && at.Before(cutoff) {
			ids = append(ids, id)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, id := range ids {
		if err := s.Delete(id); err != nil {
			return deleted, fmt.Errorf("retention removed %d dictations; cleanup stopped: %w", deleted, err)
		}
		deleted++
	}
	return deleted, nil
}
