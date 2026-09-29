package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHistoryPagesSearchBeyond500AndKeepOriginals(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for i := 0; i < 512; i++ {
		v := NewSession(fmt.Sprintf("%04d", i), 1000, fmt.Sprintf("original %d", i), "base", "en", "")
		v.CreatedAt = "2026-10-07T12:00:00Z" // Ties must not duplicate or lose rows between pages.
		if i == 0 {
			v.RawTranscript = "ÄLTERER NAME 100%_"
			v.FinalTranscript = "Corrected PostgreSQL."
		}
		if err := s.Add(v); err != nil {
			t.Fatal(err)
		}
	}
	seen := map[string]bool{}
	for page := 0; page < 11; page++ {
		got, err := s.SearchHistory("", page)
		if err != nil {
			t.Fatal(err)
		}
		if got.Total != 512 || got.PageSize != 50 || got.Page != page {
			t.Fatal("invalid page metadata")
		}
		for _, entry := range got.Entries {
			if seen[entry.ID] {
				t.Fatal("entry repeated between pages")
			}
			seen[entry.ID] = true
		}
	}
	if len(seen) != 512 {
		t.Fatal("entries beyond snapshot limit inaccessible")
	}
	for _, query := range []string{"älterer", "postgresql", "100%_"} {
		got, err := s.SearchHistory(query, 0)
		if err != nil || got.Total != 1 || got.Entries[0].ID != "0000" {
			t.Fatalf("search missed old/original/corrected/literal text for %q: %+v, %v", query, got, err)
		}
	}
	if _, err := s.SearchHistory("", -1); err == nil {
		t.Fatal("negative page accepted")
	}
	if _, err := s.SearchHistory(strings.Repeat("a", 1001), 0); err == nil {
		t.Fatal("unbounded search accepted")
	}
}

func TestBulkDeletionIsRetryableAndRemovesAudioAndCorrections(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	path := filepath.Join(s.Dir, "recordings", "one.wav")
	os.WriteFile(path, []byte("audio"), 0600)
	v := NewSession("one", 1000, "raw", "base", "en", path)
	v.FinalTranscript = "corrected"
	if err := s.Add(v); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteSessions([]string{"one", "one"}); err == nil {
		t.Fatal("duplicate selection accepted")
	}
	if _, err := s.Session("one"); err != nil {
		t.Fatal("invalid selection deleted entry")
	}
	// A directory masquerading as an audio file produces a recoverable partial failure.
	blocked := filepath.Join(s.Dir, "recordings", "blocked.wav")
	os.Mkdir(blocked, 0700)
	os.WriteFile(filepath.Join(blocked, "child"), []byte("keep"), 0600)
	if err := s.Add(NewSession("two", 1000, "second", "base", "en", blocked)); err != nil {
		t.Fatal(err)
	}
	if count, err := s.DeleteSessions([]string{"one", "two"}); err == nil || count != 1 {
		t.Fatalf("partial failure hidden: %d, %v", count, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("audio not deleted")
	}
	var outputs int
	s.db.QueryRow("SELECT COUNT(*) FROM recording_outputs").Scan(&outputs)
	if outputs != 0 {
		t.Fatal("orphaned correction")
	}
	os.Remove(filepath.Join(blocked, "child"))
	os.Remove(blocked)
	if count, err := s.DeleteSessions([]string{"one", "two"}); err != nil || count != 1 {
		t.Fatalf("retry failed: %d, %v", count, err)
	}
	if count, err := s.DeleteSessions([]string{"one", "two"}); err != nil || count != 0 {
		t.Fatal("delete retry was not idempotent")
	}
	if _, err := s.SelectedSessions([]string{"missing"}); err == nil {
		t.Fatal("stale export selection accepted")
	}
	// Already-missing audio (including its directory) does not block deletion.
	os.Remove(filepath.Join(s.Dir, "recordings"))
	if err := s.Add(NewSession("missing-audio", 1000, "raw", "base", "en", path)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteSessions([]string{"missing-audio"}); err != nil {
		t.Fatal("missing audio blocked deletion:", err)
	}
}

func TestRetentionDefaultsPreservesDatesAndDeletesOnlyExpiredEntries(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// Existing JSON omits retention and remains keep-forever.
	s.db.Exec(`INSERT INTO settings VALUES(1,'{"language":"de","saveAudio":true}')`)
	settings, err := s.Settings()
	if err != nil || settings.HistoryRetentionDays != 0 || !settings.SaveAudio || settings.Language != "de" {
		t.Fatal("legacy settings changed")
	}
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct{ id, at string }{
		{"expired", now.Add(-8 * 24 * time.Hour).Format(time.RFC3339Nano)},
		{"offset", now.Add(-8 * 24 * time.Hour).In(time.FixedZone("offset", 2*3600)).Format(time.RFC3339Nano)},
		{"boundary", now.Add(-7 * 24 * time.Hour).Format(time.RFC3339Nano)},
		{"recent", now.Format(time.RFC3339Nano)}, {"malformed", "bad-date"},
	} {
		v := NewSession(test.id, 1000, "original", "base", "de", "")
		v.CreatedAt = test.at
		v.FinalTranscript = "edited"
		if test.id == "expired" {
			v.AudioPath = filepath.Join(s.Dir, "recordings", "expired.wav")
			os.WriteFile(v.AudioPath, []byte("audio"), 0600)
		}
		if err := s.Add(v); err != nil {
			t.Fatal(err)
		}
	}
	if count, err := s.PruneHistory(0, now); err != nil || count != 0 {
		t.Fatal("default retention deleted history")
	}
	if count, err := s.PruneHistory(7, now); err != nil || count != 2 {
		t.Fatalf("wrong expiry: %d, %v", count, err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "recordings", "expired.wav")); !os.IsNotExist(err) {
		t.Fatal("expired retained audio remains")
	}
	for _, id := range []string{"boundary", "recent", "malformed"} {
		if _, err := s.Session(id); err != nil {
			t.Fatalf("removed %s", id)
		}
	}
	if count, err := s.PruneHistory(7, now); err != nil || count != 0 {
		t.Fatal("retention retry changed result")
	}
	if _, err := s.PruneHistory(-1, now); err == nil {
		t.Fatal("invalid retention accepted")
	}
	settings.HistoryRetentionDays = 30
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(s.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	loaded, err := s.Settings()
	if err != nil || loaded.HistoryRetentionDays != 30 {
		t.Fatal("retention did not persist")
	}
}
