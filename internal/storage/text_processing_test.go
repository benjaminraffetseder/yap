package storage

import (
	"reflect"
	"testing"
	"yap/internal/inference/text"
)

func TestPromptsPersistWithoutChangingLegacyRecordings(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defaults, err := s.TextProcessing()
	if err != nil || !reflect.DeepEqual(defaults, text.Defaults()) {
		t.Fatalf("unexpected defaults: %+v %v", defaults, err)
	}
	config := defaults
	config.Enabled, config.Model, config.AutoPromptID = true, "local-custom-model", "summary"
	config.Prompts = append(config.Prompts, text.Prompt{ID: "ticket", Name: "Ticket", Instruction: "Write a technical ticket."})
	if err = s.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveTextProcessing(config); err != nil {
		t.Fatal("idempotent save", err)
	}
	// Simulate the original build's positional inserts and preference writes.
	_, err = s.db.Exec(`INSERT INTO recordings VALUES('legacy','2026-10-07',1000,'original','base','en','')`)
	if err != nil {
		t.Fatal("legacy insert broken", err)
	}
	if err = s.UpdateTranscript("legacy", "edited"); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveSettings(Defaults()); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err := s.TextProcessing()
	if err != nil || !reflect.DeepEqual(got, config) {
		t.Fatalf("lost prompt preferences: %+v %v", got, err)
	}
	entry, err := s.Session("legacy")
	if err != nil || entry.RawTranscript != "original" || entry.FinalTranscript != "edited" {
		t.Fatalf("lost transcript: %+v %v", entry, err)
	}
	config.AutoPromptID = "missing"
	if err = s.SaveTextProcessing(config); err == nil {
		t.Fatal("invalid config persisted")
	}
	again, _ := s.TextProcessing()
	if !reflect.DeepEqual(again, got) {
		t.Fatal("failed save changed data")
	}
}
