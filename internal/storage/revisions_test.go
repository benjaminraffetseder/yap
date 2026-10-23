package storage

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
	"yap/internal/inference/text"
	"yap/internal/vocabulary"
)

func TestRevisionBaselineGroupingCapAndRestore(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	record := func(before, after string, when time.Time) {
		t.Helper()
		tx, err := s.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if err := recordRevision(tx, "transcript", "one", before, after, when); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	get := func() []Revision {
		t.Helper()
		values, err := s.Revisions("transcript", "one")
		if err != nil {
			t.Fatal(err)
		}
		return values
	}
	record("baseline", "first edit", now)
	record("first edit", "second edit", now.Add(9*time.Minute))
	values := get()
	if len(values) != 2 || values[1].Value != "baseline" || values[0].Value != "second edit" || values[0].CreatedAt == values[0].UpdatedAt {
		t.Fatalf("baseline/grouping: %+v", values)
	}
	record("second edit", "third edit", now.Add(10*time.Minute))
	if len(get()) != 3 {
		t.Fatal("ten-minute boundary must start a new group")
	}
	record("third edit", "baseline", now.Add(11*time.Minute))
	values = get()
	if len(values) != 4 || values[1].Value != "third edit" {
		t.Fatalf("restore lost preceding version: %+v", values)
	}
	record("baseline", "baseline", now.Add(12*time.Minute))
	if len(get()) != 4 {
		t.Fatal("no-op created a revision")
	}
	before := "baseline"
	for i := 0; i < 55; i++ {
		after := fmt.Sprintf("edit %d", i)
		record(before, after, now.Add(time.Duration(i+2)*11*time.Minute))
		before = after
	}
	values = get()
	if len(values) != 50 || values[0].Value != "edit 54" {
		t.Fatalf("cap/order: %+v", values)
	}
}

func TestTextProcessingRevisionsArePerItemAndSurviveDeletion(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	v := text.Defaults()
	v.Chains = []text.Chain{{ID: "chain", Name: "Chain", Steps: []text.ChainStep{{ID: "step", PromptID: "cleanup", Input: "original"}}}}
	if err := s.SaveTextProcessing(v); err != nil {
		t.Fatal(err)
	}
	v.Prompts[0].Instruction = "Changed instructions"
	v.Chains[0].Name = "Renamed chain"
	if err := s.SaveTextProcessing(v); err != nil {
		t.Fatal(err)
	}
	prompts, _ := s.Revisions("prompt", "cleanup")
	chains, _ := s.Revisions("chain", "chain")
	untouched, _ := s.Revisions("prompt", "summary")
	if len(prompts) != 2 || len(chains) != 2 || len(untouched) != 0 {
		t.Fatalf("per-item comparison: %d %d %d", len(prompts), len(chains), len(untouched))
	}
	var baseline text.Prompt
	if err := json.Unmarshal([]byte(prompts[1].Value), &baseline); err != nil || baseline.Instruction != text.Defaults().Prompts[0].Instruction {
		t.Fatalf("missing legacy baseline: %+v %v", baseline, err)
	}
	v.Chains = nil
	v.Prompts = v.Prompts[1:]
	if err := s.SaveTextProcessing(v); err != nil {
		t.Fatal(err)
	}
	prompts, _ = s.Revisions("prompt", "cleanup")
	chains, _ = s.Revisions("chain", "chain")
	if len(prompts) != 2 || len(chains) != 2 {
		t.Fatal("deletion lost item history")
	}
	// Deleting an unchanged legacy item also preserves its last value.
	v.Prompts = nil
	if err := s.SaveTextProcessing(v); err != nil {
		t.Fatal(err)
	}
	untouched, _ = s.Revisions("prompt", "summary")
	if len(untouched) != 1 {
		t.Fatal("legacy deletion lost its baseline")
	}
}

func TestVocabularyAndTranscriptRevisionTransactionsAndHardDelete(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	entries := []vocabulary.Entry{{ID: "one", Canonical: "Yap", Aliases: []string{}, Enabled: true}}
	if err := s.SaveVocabulary(entries); err != nil {
		t.Fatal(err)
	}
	values, _ := s.Revisions("vocabulary", "")
	if len(values) != 2 || values[1].Value != "[]" {
		t.Fatalf("vocabulary baseline: %+v", values)
	}
	if err := s.Add(NewSession("one", 100, "raw", "model", "en", "")); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateTranscript("one", "edited"); err != nil {
		t.Fatal(err)
	}
	values, _ = s.Revisions("transcript", "one")
	if len(values) != 2 || values[1].Value != "raw" {
		t.Fatalf("transcript baseline: %+v", values)
	}
	if err := s.UpdateTranscript("missing", "edited"); err == nil {
		t.Fatal("saved missing recording")
	}
	if err := s.UpdateTranscript("one", " "); err == nil {
		t.Fatal("saved empty text")
	}
	if err := s.TrashSessions([]string{"one"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	values, _ = s.Revisions("transcript", "one")
	if len(values) != 2 {
		t.Fatal("soft deletion must retain revisions")
	}
	if _, err := s.PermanentlyDeleteSessions([]string{"one"}); err != nil {
		t.Fatal(err)
	}
	values, _ = s.Revisions("transcript", "one")
	if len(values) != 0 {
		t.Fatal("hard deletion left transcript revisions")
	}
	values, _ = s.Revisions("vocabulary", "")
	if len(values) != 2 {
		t.Fatal("hard deletion affected other history")
	}
	if _, err := s.Revisions("unknown", ""); err == nil {
		t.Fatal("accepted invalid kind")
	}
}

func TestRevisionFailureRollsBackContent(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Add(NewSession("one", 100, "raw", "model", "en", "")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER fail_revision BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateTranscript("one", "edited"); err == nil {
		t.Fatal("expected revision failure")
	}
	value, err := s.Session("one")
	if err != nil || value.FinalTranscript != "raw" {
		t.Fatalf("partial transcript save: %+v %v", value, err)
	}
	if err := s.SaveVocabulary([]vocabulary.Entry{}); err != nil {
		t.Fatal("unchanged content should not record a revision", err)
	}
	v := text.Defaults()
	v.Prompts[0].Name = "Changed"
	if err := s.SaveTextProcessing(v); err == nil {
		t.Fatal("expected revision failure")
	}
	got, err := s.TextProcessing()
	if err != nil || got.Prompts[0].Name != "Cleanup" {
		t.Fatalf("partial config save: %+v %v", got, err)
	}
}
