package storage

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestHistorySortColumnsAndDirections(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	fixtures := []struct {
		id, title, raw, final, created string
		duration                       int64
	}{
		{"a", "Äpfel", "original needle", "Zebra", "2026-10-08T12:00:00+02:00", 9000},
		{"b", "", "original needle", "äRGER", "2026-10-08T11:00:00Z", 1000},
		{"c", "", "Banana needle", "Banana needle", "2026-10-08T09:00:00-03:00", 3000},
	}
	now := time.Now().UTC()
	for i, fixture := range fixtures {
		entry := NewSession(fixture.id, fixture.duration, fixture.raw, "base", "en", "")
		entry.CreatedAt, entry.FinalTranscript = fixture.created, fixture.final
		if err := s.Add(entry); err != nil {
			t.Fatal(err)
		}
		if fixture.title != "" {
			if err := s.SaveSessionTitle(entry.ID, fixture.title); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.TrashSessions([]string{entry.ID}, now.Add(time.Duration(2-i)*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	for _, deleted := range []bool{true, false} {
		for column, ascending := range map[string][]string{
			"dictation":  {"c", "a", "b"},
			"createdAt":  {"a", "b", "c"},
			"deletedAt":  {"c", "b", "a"},
			"durationMs": {"b", "c", "a"},
		} {
			if column == "deletedAt" && !deleted {
				continue
			}
			for _, descending := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/desc=%t/deleted=%t", column, descending, deleted), func(t *testing.T) {
					page, err := s.SearchSortedHistory("needle", 0, column, descending, deleted)
					if err != nil || page.Total != 3 {
						t.Fatalf("search: %+v, %v", page, err)
					}
					want := slices.Clone(ascending)
					if descending {
						slices.Reverse(want)
					}
					got := []string{}
					for _, entry := range page.Entries {
						got = append(got, entry.ID)
					}
					if !slices.Equal(got, want) {
						t.Fatalf("got %v, want %v", got, want)
					}
				})
			}
		}
		if deleted {
			if err := s.RestoreSessions([]string{"a", "b", "c"}, now); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, column := range []string{"", "deletedAt", "r.id; DROP TABLE recordings"} {
		if _, err := s.SearchSortedHistory("", 0, column, false, false); err == nil {
			t.Fatalf("invalid sort accepted: %q", column)
		}
	}
	if _, err := s.SearchSortedHistory("", -1, "dictation", false, false); err == nil {
		t.Fatal("negative page accepted")
	}
	if _, err := s.SearchSortedHistory(strings.Repeat("a", 1001), 0, "dictation", false, false); err == nil {
		t.Fatal("unbounded query accepted")
	}
}

func TestHistorySortPrecedesPaginationAndKeepsStableTies(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for i := 0; i < 105; i++ {
		entry := NewSession(fmt.Sprintf("%03d", i), int64(i/2), fmt.Sprintf("Note %03d", 104-i), "base", "en", "")
		if err := s.Add(entry); err != nil {
			t.Fatal(err)
		}
	}
	for _, column := range []string{"dictation", "durationMs"} {
		for _, descending := range []bool{false, true} {
			entries := []Session{}
			seen := map[string]bool{}
			for page := 0; page < 3; page++ {
				result, err := s.SearchSortedHistory("Note", page, column, descending, false)
				if err != nil || result.Total != 105 || result.Page != page {
					t.Fatalf("page: %+v, %v", result, err)
				}
				for _, entry := range result.Entries {
					if seen[entry.ID] {
						t.Fatalf("duplicate across pages: %s", entry.ID)
					}
					seen[entry.ID] = true
					entries = append(entries, entry)
				}
			}
			if len(entries) != 105 {
				t.Fatalf("missing entries: %d", len(entries))
			}
			for i := 1; i < len(entries); i++ {
				previous, current := entries[i-1], entries[i]
				comparison := strings.Compare(previous.FinalTranscript, current.FinalTranscript)
				if column == "durationMs" {
					comparison = int(previous.DurationMS - current.DurationMS)
				}
				if (!descending && comparison > 0) || (descending && comparison < 0) || (comparison == 0 && previous.ID < current.ID) {
					t.Fatalf("%s desc=%t out of order: %s, %s", column, descending, previous.ID, current.ID)
				}
			}
		}
	}
}
