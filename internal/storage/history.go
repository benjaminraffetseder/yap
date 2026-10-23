package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"modernc.org/sqlite"
)

func init() {
	// Query-only collation preserves legacy/backup dates and the existing schema.
	// SQLite's date helpers lose fractional precision; compare full timestamps.
	sqlite.MustRegisterCollationUtf8("yap_datetime", compareHistoryDates)
}

func compareHistoryDates(left, right string) int {
	a, aErr := time.Parse(time.RFC3339Nano, left)
	b, bErr := time.Parse(time.RFC3339Nano, right)
	switch {
	case aErr == nil && bErr == nil:
		return a.Compare(b)
	case aErr == nil:
		return 1
	case bErr == nil:
		return -1
	default:
		// Preserve malformed legacy entries after dated entries, with stable ties.
		return strings.Compare(left, right)
	}
}

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
	return s.searchHistory(query, page, false)
}

func (s *Store) SearchRecentlyDeleted(query string, page int) (HistoryPage, error) {
	return s.searchHistory(query, page, true)
}

func (s *Store) searchHistory(query string, page int, deleted bool) (HistoryPage, error) {
	out := HistoryPage{Entries: []Session{}, Page: page, PageSize: HistoryPageSize}
	if page < 0 || page > 1000000 || len(query) > 1000 {
		return out, errors.New("invalid History search or page")
	}
	filter, order := "d.id IS NULL", "r.created_at"
	if deleted {
		filter, order = "d.id IS NOT NULL", "d.deleted_at"
	}
	rows, err := s.db.Query(`SELECT r.id,r.created_at,r.duration_ms,r.transcript,r.model,r.language,r.audio_path,COALESCE(o.transcript,r.transcript),COALESCE(d.deleted_at,'')
		FROM recordings r LEFT JOIN recording_outputs o ON r.id=o.id LEFT JOIN deleted_recordings d ON d.id=r.id WHERE ` + filter + ` ORDER BY ` + order + ` COLLATE yap_datetime DESC,r.id DESC`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	query = strings.ToLower(query)
	for rows.Next() {
		var v Session
		if err := rows.Scan(&v.ID, &v.CreatedAt, &v.DurationMS, &v.RawTranscript, &v.SpeechModel, &v.Language, &v.AudioPath, &v.FinalTranscript, &v.DeletedAt); err != nil {
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
		v, err := s.sessionIncludingDeleted(id)
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
	if err := s.RecoverPendingDeletes(); err != nil {
		return 0, err
	}
	deleted, err := s.PruneRecentlyDeleted(now)
	if err != nil || days == 0 {
		return deleted, err
	}
	rows, err := s.db.Query("SELECT id,created_at FROM recordings WHERE NOT EXISTS (SELECT 1 FROM deleted_recordings d WHERE d.id=recordings.id)")
	if err != nil {
		return deleted, err
	}
	cutoff := now.Add(-time.Duration(days) * 24 * time.Hour)
	ids := []string{}
	for rows.Next() {
		var id, created string
		if err := rows.Scan(&id, &created); err != nil {
			rows.Close()
			return deleted, err
		}
		if at, err := time.Parse(time.RFC3339Nano, created); err == nil && at.Before(cutoff) {
			ids = append(ids, id)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return deleted, err
	}
	for _, id := range ids {
		if err := s.Delete(id); err != nil {
			return deleted, fmt.Errorf("retention removed %d dictations; cleanup stopped: %w", deleted, err)
		}
		deleted++
	}
	return deleted, nil
}
