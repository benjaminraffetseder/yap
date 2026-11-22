package storage

import (
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"time"

	"modernc.org/sqlite"
)

func init() {
	// Both strings are used only during the callback, while SQLite owns them.
	sqlite.MustRegisterFunction("yap_history_contains", &sqlite.FunctionImpl{
		NArgs: 2, Deterministic: true, VolatileArgs: true,
		Scalar: func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			value, ok := args[0].(string)
			return ok && strings.Contains(strings.ToLower(value), args[1].(string)), nil
		},
	})
	// Compare legacy dates with their full fractional precision and offset.
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

// The ordinary UTC format written by NewSession has a fixed-width seconds prefix
// and optional fractional digits. Index its padded nanoseconds with SQLite
// builtins so older binaries can continue writing without our collations.
type historyDate struct{ table, column, alias string }

var createdDate = historyDate{"recordings", "created_at", "r"}
var deletedDate = historyDate{"deleted_recordings", "deleted_at", "d"}

func utcHistoryKey(column string) string {
	return fmt.Sprintf(`substr(%[1]s,1,19) || substr(substr(rtrim(%[1]s,'Z'),21) || '000000000',1,9)`, column)
}

func (d historyDate) exceptional() string {
	// A seconds-prefix round trip rejects invalid calendar dates. Restrict the
	// date helper to year-prefixed inputs (SQLite also accepts "now").
	return fmt.Sprintf(`CASE WHEN %[1]s GLOB '[0-9][0-9][0-9][0-9]-*' THEN (
        instr(%[1]s,char(0))=0 AND substr(%[1]s,-1)='Z'
        AND substr(%[1]s,1,19)=strftime('%%Y-%%m-%%dT%%H:%%M:%%S',substr(%[1]s,1,19)||'Z','+0 seconds')
        AND (length(%[1]s)=20 OR (length(%[1]s)>21 AND substr(%[1]s,20,1)='.'
            AND substr(%[1]s,21,length(%[1]s)-21) NOT GLOB '*[^0-9]*')))
        END IS NOT TRUE`, d.column)
}

func (d historyDate) indexes() string {
	return fmt.Sprintf(`CREATE INDEX IF NOT EXISTS history_%[1]s ON %[2]s(%[3]s DESC,id DESC);
        CREATE INDEX IF NOT EXISTS history_legacy_%[1]s ON %[2]s(id) WHERE %[4]s;`,
		d.column, d.table, utcHistoryKey(d.column), d.exceptional())
}

func (d historyDate) order(tx *sql.Tx) (string, error) {
	var legacy bool
	err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM ` + d.table + ` WHERE ` + d.exceptional() + `)`).Scan(&legacy)
	column := d.alias + "." + d.column
	if legacy {
		return column + " COLLATE yap_datetime", err
	}
	return utcHistoryKey(column), err
}

// Keep the count, date-format check and result page on the same SQLite snapshot.
func (s *Store) SearchSortedHistory(query string, page int, sortBy string, descending, deleted bool) (HistoryPage, error) {
	out := HistoryPage{Entries: []Session{}, Page: page, PageSize: HistoryPageSize}
	if page < 0 || page > 1000000 || len(query) > 1000 {
		return out, errors.New("invalid History search or page")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var order string
	switch sortBy {
	case "dictation":
		order = "COALESCE(NULLIF(" + sessionTitleColumn + ",''),o.transcript,r.transcript) COLLATE yap_text"
	case "createdAt":
		order, err = createdDate.order(tx)
	case "deletedAt":
		if !deleted {
			return out, errors.New("invalid History sort column")
		}
		order, err = deletedDate.order(tx)
	case "durationMs":
		order = "r.duration_ms"
	default:
		return out, errors.New("invalid History sort column")
	}
	if err != nil {
		return out, err
	}
	if descending {
		order += " DESC"
	} else {
		order += " ASC"
	}
	order += ",r.id DESC"
	from, args := historyFrom(query, deleted, false)
	if err := tx.QueryRow("SELECT count(*)"+from, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	if page*HistoryPageSize < out.Total {
		out.Entries, err = readHistoryPage(tx, query, deleted, order, HistoryPageSize, page*HistoryPageSize)
		if err != nil {
			return out, err
		}
	}
	return out, tx.Commit()
}

func historyFrom(query string, deleted, outputs bool) (string, []any) {
	from := " FROM recordings r"
	filter := " WHERE NOT EXISTS (SELECT 1 FROM deleted_recordings d WHERE d.id=r.id)"
	if deleted {
		from += " JOIN deleted_recordings d ON d.id=r.id"
		filter = " WHERE 1=1"
	}
	if outputs || query != "" {
		from += " LEFT JOIN recording_outputs o ON o.id=r.id"
	}
	if query == "" {
		return from + filter, nil
	}
	// A missing output has the same text as the raw transcript, already tested.
	filter += ` AND (yap_history_contains(CAST(r.transcript AS TEXT),?1)
        OR yap_history_contains(CAST(o.transcript AS TEXT),?1)
        OR yap_history_contains(CAST(` + sessionTitleColumn + ` AS TEXT),?1))`
	return from + filter, []any{strings.ToLower(query)}
}

func readHistoryPage(tx *sql.Tx, query string, deleted bool, order string, limit, offset int) ([]Session, error) {
	from, args := historyFrom(query, deleted, true)
	stamp := "''"
	if deleted {
		stamp = "d.deleted_at"
	}
	rows, err := tx.Query(`SELECT r.id,r.created_at,r.duration_ms,r.transcript,r.model,r.language,r.audio_path,COALESCE(o.transcript,r.transcript),`+stamp+","+sessionTitleColumn+","+speechStatsColumn+from+" ORDER BY "+order+" LIMIT ? OFFSET ?", append(args, limit, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []Session{}
	for rows.Next() {
		var entry Session
		if err := scanSession(rows, &entry, true); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

// MatchingHistoryIDs only projects the identifiers required by selection and export.
func (s *Store) MatchingHistoryIDs(query string) ([]string, error) {
	ids := []string{}
	if len(query) > 1000 {
		return ids, errors.New("invalid History search or page")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return ids, err
	}
	defer tx.Rollback()
	order, err := createdDate.order(tx)
	if err != nil {
		return ids, err
	}
	from, args := historyFrom(query, false, false)
	rows, err := tx.Query("SELECT r.id"+from+" ORDER BY "+order+" DESC,r.id DESC", args...)
	if err != nil {
		return ids, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return ids, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return ids, err
	}
	return ids, tx.Commit()
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
