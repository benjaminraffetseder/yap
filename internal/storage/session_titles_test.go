package storage

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
)

func TestSessionTitleExpandsLegacyDatabaseWithoutChangingOriginalSQL(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "database.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE recordings (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, transcript TEXT NOT NULL, model TEXT NOT NULL, language TEXT NOT NULL, audio_path TEXT NOT NULL);
		INSERT INTO recordings VALUES('legacy','2020-01-01T00:00:00Z',1000,'original text','base','en','');`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SaveSessionTitle("legacy", "  Planning notes  "); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err := s.Session("legacy")
	if err != nil || got.Title != "Planning notes" || got.RawTranscript != "original text" || got.FinalTranscript != "original text" {
		t.Fatalf("legacy data changed: %+v %v", got, err)
	}
	// Original builds still insert seven values and delete through the trigger.
	if _, err := s.db.Exec(`INSERT INTO recordings VALUES('old-writer','2020-01-02T00:00:00Z',1000,'second original','tiny','en','')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`DELETE FROM recordings WHERE id='legacy'`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM recording_titles").Scan(&count); err != nil || count != 0 {
		t.Fatal("old deletion orphaned titles", count, err)
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM pragma_table_info('recordings')").Scan(&count); err != nil || count != 7 {
		t.Fatal("original schema changed", count, err)
	}
}

func TestSessionTitlePreservesTextAudioOutputsAndRecovery(t *testing.T) {
	s := backupStore(t)
	path := filepath.Join(s.Dir, "recordings", "one.wav")
	if err := os.WriteFile(path, []byte("keep audio"), 0600); err != nil {
		t.Fatal(err)
	}
	entry := NewSession("one", 1200, "um, original", "base", "en", path)
	entry.FinalTranscript = "Edited text."
	entry.Stats = &SpeechStats{TranscriptionMS: 400, Engine: "whisper"}
	if err := s.Add(entry); err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "local-model"
	prompt, _ := config.Prompt("summary")
	output := NewGeneratedOutput(entry.ID, entry.FinalTranscript, "Saved summary", config, prompt)
	if err := s.AddGeneratedOutput(output); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := s.SaveSessionTitle(entry.ID, "会議メモ 🎙️"); err != nil {
			t.Fatal(err)
		}
	}
	want := entry
	want.Title = "会議メモ 🎙️"
	got, err := s.Session(entry.ID)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("rename changed capture/text: %+v %v", got, err)
	}
	outputs, err := s.GeneratedOutputs(entry.ID)
	if err != nil || len(outputs) != 1 || !reflect.DeepEqual(outputs[0], output) {
		t.Fatal("rename changed generated outputs", outputs, err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil || string(bytes) != "keep audio" {
		t.Fatal("rename changed audio", err)
	}
	page, err := s.SearchHistory("会議", 0)
	if err != nil || page.Total != 1 || page.Entries[0].Title != want.Title {
		t.Fatal("title not searchable", page, err)
	}
	if err := s.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveSessionTitle(entry.ID, "forbidden"); err == nil {
		t.Fatal("renamed deleted recording")
	}
	deleted, err := s.SearchRecentlyDeleted("会議", 0)
	if err != nil || deleted.Total != 1 || deleted.Entries[0].Title != want.Title {
		t.Fatal("trash lost title", deleted, err)
	}
	if err := s.RestoreSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	got, err = s.Session(entry.ID)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatal("restore changed recording", got, err)
	}
	if err := s.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PermanentlyDeleteSessions([]string{entry.ID}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM recording_titles").Scan(&count); err != nil || count != 0 {
		t.Fatal("permanent deletion orphaned title", count, err)
	}
}

func TestSessionTitleValidationAndClearingAreAtomic(t *testing.T) {
	s := backupStore(t)
	entry := NewSession("one", 1000, "original", "base", "en", "")
	entry.Title = "Initial title"
	if err := s.Add(entry); err != nil {
		t.Fatal(err)
	}
	for _, title := range []string{strings.Repeat("界", 81), "two\nlines", "null\x00text", "tab\ttext", "line\u2028break", string([]byte{0xff})} {
		if err := s.SaveSessionTitle(entry.ID, title); err == nil {
			t.Fatalf("invalid title accepted: %q", title)
		}
		got, err := s.Session(entry.ID)
		if err != nil || got != entry {
			t.Fatal("invalid rename changed data", got, err)
		}
	}
	if err := s.SaveSessionTitle("missing", "No orphan"); err == nil {
		t.Fatal("rename created an entry")
	}
	if err := s.SaveSessionTitle(entry.ID, strings.Repeat("界", 80)); err != nil {
		t.Fatal("valid Unicode title rejected", err)
	}
	for range 2 {
		if err := s.SaveSessionTitle(entry.ID, "   "); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Session(entry.ID)
	entry.Title = ""
	if err != nil || got != entry {
		t.Fatal("clear changed transcript", got, err)
	}
	bad := NewSession("bad", 1000, "must not be inserted", "base", "en", "")
	bad.Title = "invalid\nname"
	if err := s.Add(bad); err == nil {
		t.Fatal("invalid added title accepted")
	}
	if _, err := s.Session(bad.ID); err != sql.ErrNoRows {
		t.Fatal("invalid Add partially committed", err)
	}
}

func TestSessionTitlesRoundTripBackupAndPreserveLocalDuplicateName(t *testing.T) {
	ctx := context.Background()
	source := backupStore(t)
	entry := NewSession("one", 1000, "original", "base", "en", "")
	entry.Title = "Sprint planning"
	if err := source.Add(entry); err != nil {
		t.Fatal(err)
	}
	legacy := NewSession("legacy", 1000, "no title in old format", "tiny", "en", "")
	if err := source.Add(legacy); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "titles.zip")
	if _, err := source.ExportBackup(ctx, path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	if _, err := dest.RestoreBackup(ctx, archive, false); err != nil {
		t.Fatal(err)
	}
	got, err := dest.Session(entry.ID)
	if err != nil || got != entry {
		t.Fatal("backup lost title or recording", got, err)
	}
	got, err = dest.Session(legacy.ID)
	if err != nil || got != legacy {
		t.Fatal("untitled v1 data changed", got, err)
	}
	if err := dest.SaveSessionTitle(entry.ID, "Local renamed version"); err != nil {
		t.Fatal(err)
	}
	if _, err := dest.RestoreBackup(ctx, archive, false); err != nil {
		t.Fatal(err)
	}
	got, err = dest.Session(entry.ID)
	if err != nil || got.Title != "Local renamed version" || got.RawTranscript != entry.RawTranscript {
		t.Fatal("duplicate restore overwrote local name", got, err)
	}
	archive.manifest.Sessions[0].Title = "invalid\nbackup title"
	if err := validateBackupManifest(&archive.manifest); err == nil {
		t.Fatal("invalid backup title accepted")
	}
}
