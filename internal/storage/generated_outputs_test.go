package storage

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	textmodel "yap/internal/inference/text"
)

func TestGeneratedOutputsPreserveTranscriptsAndPersistVersions(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	entry := NewSession("one", 1000, "raw", "base", "en", "")
	entry.FinalTranscript = "edited transcription"
	if err := s.Add(entry); err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "local-model"
	prompt, _ := config.Prompt("summary")
	first := NewGeneratedOutput(entry.ID, entry.FinalTranscript, "First summary", config, prompt)
	if err := s.AddGeneratedOutput(first); err != nil {
		t.Fatal(err)
	}
	second := NewGeneratedOutput(entry.ID, entry.FinalTranscript, "Second summary", config, prompt)
	if err := s.AddGeneratedOutput(second); err != nil {
		t.Fatal(err)
	}
	if err := s.AddGeneratedOutput(first); err == nil {
		t.Fatal("duplicate replaced a saved version")
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err := s.Session(entry.ID)
	if err != nil || got != entry {
		t.Fatalf("transcription changed: %+v %v", got, err)
	}
	outputs, err := s.GeneratedOutputs(entry.ID)
	if err != nil || !reflect.DeepEqual(outputs, []GeneratedOutput{second, first}) {
		t.Fatalf("versions: %+v %v", outputs, err)
	}
	if _, err := s.GeneratedOutput("other", first.ID); err != sql.ErrNoRows {
		t.Fatal("output crossed dictation boundary", err)
	}
	if err := s.DeleteGeneratedOutput("other", first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GeneratedOutput(entry.ID, first.ID); err != nil {
		t.Fatal("deleted another dictation's output", err)
	}
	if err := s.DeleteGeneratedOutput(entry.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteGeneratedOutput(entry.ID, first.ID); err != nil {
		t.Fatal("delete retry", err)
	}
	outputs, _ = s.GeneratedOutputs(entry.ID)
	if len(outputs) != 1 || outputs[0] != second {
		t.Fatal("wrong output removed", outputs)
	}
	if err := s.Delete(entry.ID); err != nil {
		t.Fatal(err)
	}
	outputs, _ = s.GeneratedOutputs(entry.ID)
	if len(outputs) != 0 {
		t.Fatal("deleted dictation left outputs", outputs)
	}
	if err := s.AddGeneratedOutput(first); err == nil {
		t.Fatal("saved output for a missing dictation")
	}
}

func TestGeneratedOutputMigrationPreservesLegacyReadsWritesAndDeletes(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "database.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE recordings (id TEXT PRIMARY KEY,created_at TEXT NOT NULL,duration_ms INTEGER NOT NULL,transcript TEXT NOT NULL,model TEXT NOT NULL,language TEXT NOT NULL,audio_path TEXT NOT NULL);
CREATE TABLE recording_outputs (id TEXT PRIMARY KEY,transcript TEXT NOT NULL);
INSERT INTO recordings VALUES('legacy','2026',1000,'original','base','en','');
INSERT INTO recording_outputs VALUES('legacy','previous result');`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	for i := 0; i < 2; i++ {
		s, err := Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		entry, err := s.Session("legacy")
		if err != nil || entry.RawTranscript != "original" || entry.FinalTranscript != "previous result" {
			t.Fatal("legacy data changed", entry, err)
		}
		outputs, err := s.GeneratedOutputs(entry.ID)
		if err != nil || len(outputs) != 0 {
			t.Fatal("legacy result received invented provenance", outputs, err)
		}
		s.Close()
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "model"
	v := NewGeneratedOutput("legacy", "previous result", "new summary", config, config.Prompts[1])
	if err := s.AddGeneratedOutput(v); err != nil {
		t.Fatal(err)
	}
	// Rollback is opening the unchanged tables with an older binary. Its positional
	// writes still work, and its deletes fire both cleanup triggers.
	if _, err := s.db.Exec(`INSERT INTO recordings VALUES('old-writer','2026',1000,'old write','base','en','');
INSERT INTO recording_outputs VALUES('old-writer','old correction');
DELETE FROM recordings WHERE id='legacy';`); err != nil {
		t.Fatal("old writer incompatible", err)
	}
	outputs, err := s.GeneratedOutputs("legacy")
	if err != nil || len(outputs) != 0 {
		t.Fatal("old delete orphaned outputs", outputs, err)
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM recording_outputs WHERE id='legacy'").Scan(&count); err != nil || count != 0 {
		t.Fatal("old delete left saved text", count, err)
	}
}

func TestInvalidGeneratedOutputsDoNotChangeSavedData(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	entry := NewSession("one", 1000, "raw", "base", "en", "")
	if err := s.Add(entry); err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "model"
	valid := NewGeneratedOutput(entry.ID, "raw", "result", config, config.Prompts[1])
	for _, change := range []func(*GeneratedOutput){
		func(v *GeneratedOutput) { v.Text = "" },
		func(v *GeneratedOutput) { v.Input = "\x00" },
		func(v *GeneratedOutput) { v.Prompt.Instruction = "" },
		func(v *GeneratedOutput) { v.Model = "" },
		func(v *GeneratedOutput) { v.Endpoint = "http://example.com/v1" },
		func(v *GeneratedOutput) { v.CreatedAt = "invalid" },
	} {
		v := valid
		change(&v)
		if err := s.AddGeneratedOutput(v); err == nil {
			t.Fatal("invalid output accepted", v)
		}
	}
	outputs, _ := s.GeneratedOutputs(entry.ID)
	if len(outputs) != 0 {
		t.Fatal("failed writes saved outputs", outputs)
	}
	got, _ := s.Session(entry.ID)
	if got != entry {
		t.Fatal("failed output changed transcript")
	}
}
