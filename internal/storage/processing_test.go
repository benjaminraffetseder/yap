package storage

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	"yap/internal/vocabulary"
)

func TestAdditiveMigrationPreservesLegacyRecordsAndWriters(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "database.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
CREATE TABLE recordings (id TEXT PRIMARY KEY,created_at TEXT NOT NULL,duration_ms INTEGER NOT NULL,transcript TEXT NOT NULL,model TEXT NOT NULL,language TEXT NOT NULL,audio_path TEXT NOT NULL);
INSERT INTO recordings VALUES('old','2020-01-01',1000,'original','tiny','en','');
INSERT INTO settings VALUES(1,'{"whisperPath":"/whisper","modelPath":"/model","language":"de","saveAudio":true}');`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	for i := 0; i < 2; i++ {
		s, err := Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		settings, err := s.Settings()
		if err != nil || !settings.SetupComplete || settings.CleanText || !settings.SaveAudio || settings.Language != "de" {
			t.Fatalf("legacy preferences changed: %+v %v", settings, err)
		}
		old, err := s.Session("old")
		if err != nil || old.RawTranscript != "original" || old.FinalTranscript != "original" {
			t.Fatalf("legacy recording changed: %+v %v", old, err)
		}
		s.Close()
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// The old app's positional INSERT remains compatible after migration.
	if _, err := s.db.Exec(`INSERT INTO recordings VALUES('old-writer','2021',1000,'legacy writer','base','en','')`); err != nil {
		t.Fatal(err)
	}
	v := NewSession("processed", 1000, "um, raw", "base", "en", "")
	v.FinalTranscript = "Raw."
	if err := s.Add(v); err != nil {
		t.Fatal(err)
	}
	got, err := s.Session(v.ID)
	if err != nil || got != v {
		t.Fatalf("processed round trip: %+v %v", got, err)
	}
	// Old app deletion must remove processed text too, without foreign-key pragmas.
	if _, err := s.db.Exec(`DELETE FROM recordings WHERE id='processed'`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM recording_outputs`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("processed transcript orphaned: %d %v", count, err)
	}
}

func TestVocabularyAndProcessingPreferencesPersist(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	settings := Defaults()
	settings.CleanText = true
	settings.SetupComplete = true
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	entries := []vocabulary.Entry{{ID: "one", Canonical: "Yap", Aliases: []string{"yapp"}, Enabled: true}}
	if err := s.SaveVocabulary(entries); err != nil {
		t.Fatal(err)
	}
	v := NewSession("one", 1000, "yapp", "tiny", "en", "")
	v.FinalTranscript = "Yap"
	if err := s.Add(v); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err := s.Vocabulary()
	if err != nil || !reflect.DeepEqual(got, entries) {
		t.Fatalf("vocabulary lost: %+v %v", got, err)
	}
	preferences, err := s.Settings()
	if err != nil || preferences != settings {
		t.Fatalf("preferences changed: %+v %v", preferences, err)
	}
	history, err := s.History()
	if err != nil || len(history) != 1 || history[0] != v {
		t.Fatalf("processed history lost: %+v %v", history, err)
	}
}

func TestProcessedWriteFailureRollsBackOriginal(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.db.Exec(`INSERT INTO recording_outputs VALUES('one','already present')`); err != nil {
		t.Fatal(err)
	}
	v := NewSession("one", 1000, "raw", "tiny", "en", "")
	v.FinalTranscript = "processed"
	if err := s.Add(v); err == nil {
		t.Fatal("accepted duplicate processed output")
	}
	if _, err := s.Session("one"); err != sql.ErrNoRows {
		t.Fatalf("failed transaction saved original: %v", err)
	}
}
