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
	sqlite.MustRegisterCollationUtf8("yap_text", func(left, right string) int {
		return strings.Compare(strings.ToLower(left), strings.ToLower(right))
	})
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
	sortBy := "createdAt"
	if deleted {
		sortBy = "deletedAt"
	}
	return s.SearchSortedHistory(query, page, sortBy, true, deleted)
}

// Sort the complete matching history before slicing pages, without retaining
// every transcript in memory. Column names and directions are allowlisted.
func (s *Store) SearchSortedHistory(query string, page int, sortBy string, descending, deleted bool) (HistoryPage, error) {
	out := HistoryPage{Entries: []Session{}, Page: page, PageSize: HistoryPageSize}
	if page < 0 || page > 1000000 {
		return out, errors.New("invalid History search or page")
	}
	order := ""
	switch sortBy {
	case "dictation":
		order = "COALESCE(NULLIF(" + sessionTitleColumn + ",''),o.transcript,r.transcript) COLLATE yap_text"
	case "createdAt":
		order = "r.created_at COLLATE yap_datetime"
	case "deletedAt":
		if !deleted {
			return out, errors.New("invalid History sort column")
		}
		order = "d.deleted_at COLLATE yap_datetime"
	case "durationMs":
		order = "r.duration_ms"
	default:
		return out, errors.New("invalid History sort column")
	}
	if descending {
		order += " DESC"
	} else {
		order += " ASC"
	}
	err := s.visitHistoryOrdered(query, deleted, order+",r.id DESC", func(v Session) {
		if out.Total >= page*HistoryPageSize && len(out.Entries) < HistoryPageSize {
			out.Entries = append(out.Entries, v)
		}
		out.Total++
	})
	return out, err
}

// MatchingHistoryIDs uses the same search and ordering as the paginated list.
func (s *Store) MatchingHistoryIDs(query string) ([]string, error) {
	ids := []string{}
	err := s.visitHistory(query, false, func(v Session) { ids = append(ids, v.ID) })
	return ids, err
}

func (s *Store) visitHistory(query string, deleted bool, visit func(Session)) error {
	order := "r.created_at"
	if deleted {
		order = "d.deleted_at"
	}
	return s.visitHistoryOrdered(query, deleted, order+" COLLATE yap_datetime DESC,r.id DESC", visit)
}

func (s *Store) visitHistoryOrdered(query string, deleted bool, order string, visit func(Session)) error {
	if len(query) > 1000 {
		return errors.New("invalid History search or page")
	}
	filter := "d.id IS NULL"
	if deleted {
		filter = "d.id IS NOT NULL"
	}
	rows, err := s.db.Query(`SELECT r.id,r.created_at,r.duration_ms,r.transcript,r.model,r.language,r.audio_path,COALESCE(o.transcript,r.transcript),COALESCE(d.deleted_at,''),` + sessionTitleColumn + `,` + speechStatsColumn + `
		FROM recordings r LEFT JOIN recording_outputs o ON r.id=o.id LEFT JOIN deleted_recordings d ON d.id=r.id WHERE ` + filter + ` ORDER BY ` + order)
	if err != nil {
		return err
	}
	defer rows.Close()
	query = strings.ToLower(query)
	for rows.Next() {
		var v Session
		if err := scanSession(rows, &v, true); err != nil {
			return err
		}
		if query != "" && !strings.Contains(strings.ToLower(v.Title), query) && !strings.Contains(strings.ToLower(v.RawTranscript), query) && !strings.Contains(strings.ToLower(v.FinalTranscript), query) {
			continue
		}
		visit(v)
	}
	return rows.Err()
}

// Resolve the entire selection before export. The app serializes reads and writes.
func (s *Store) SelectedSessions(ids []string) ([]Session, error) {
	if len(ids) == 0 {
		return nil, errors.New("select at least one dictation")
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
