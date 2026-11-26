package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
)

func editingFixture(t *testing.T) (*Store, Session, GeneratedOutput) {
	t.Helper()
	s := backupStore(t)
	entry := NewSession("editing", 1000, "Original speech", "speech-model", "de", "")
	entry.FinalTranscript = "Previously corrected transcript"
	config := textmodel.Defaults()
	config.Model = "local-model"
	output := NewGeneratedOutput(entry.ID, "Immutable generation input", "Generated original", config, config.Prompts[0])
	output.Chain = OutputChain{RunID: "run", ChainID: "recipe", Name: "Recipe", StepID: "step", Step: 1, Total: 2, Input: "transcript"}
	output.Stats = &textmodel.Stats{DurationMS: 50, ResponseMS: 30, Attempts: 1, Model: config.Model}
	output.Citations = &OutputCitations{Source: "original", References: ChatReferences("Reference [[1]]", output.Input)}
	if err := s.AddWithOutputs(entry, []GeneratedOutput{output}); err != nil {
		t.Fatal(err)
	}
	return s, entry, output
}

func TestCheckedTranscriptWritesRejectRacesAndPreserveSpeech(t *testing.T) {
	s, entry, _ := editingFixture(t)
	if err := s.UpdateTranscriptChecked(entry.ID, "Wrong baseline", entry.RawTranscript); !errors.Is(err, ErrContentChanged) {
		t.Fatal("guard ignored processed transcript", err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for i := 0; i < cap(results); i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results <- s.UpdateTranscriptChecked(entry.ID, fmt.Sprint("Edit ", i), entry.FinalTranscript)
		}(i)
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrContentChanged) {
			t.Fatal("unexpected save failure", err)
		}
	}
	if successes != 1 {
		t.Fatal("concurrent saves overwrote each other", successes)
	}
	got, err := s.Session(entry.ID)
	if err != nil || got.RawTranscript != entry.RawTranscript || got.FinalTranscript == entry.FinalTranscript {
		t.Fatal("saved text or speech provenance lost", got, err)
	}
	if err := s.UpdateTranscriptChecked(entry.ID, got.FinalTranscript, entry.FinalTranscript); !errors.Is(err, ErrContentChanged) {
		t.Fatal("unchanged submitted text bypassed stale guard", err)
	}
	if err := s.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateTranscriptChecked(entry.ID, "Late save", got.FinalTranscript); err == nil {
		t.Fatal("edited a trashed dictation")
	}
}

func TestOutputEditsPreserveRecipeOriginalAndBoundedRevisions(t *testing.T) {
	s, entry, original := editingFixture(t)
	output, err := s.UpdateGeneratedOutput(entry.ID, original.ID, "First edit", original.Text)
	if err != nil || !output.Edited || output.OriginalText != original.Text || output.Text != "First edit" {
		t.Fatal("edit did not preserve both versions", output, err)
	}
	want := original
	want.Text, want.Edited = output.Text, true
	if !reflect.DeepEqual(output, want) {
		t.Fatal("editing changed generation metadata", output, want)
	}
	if _, err := s.UpdateGeneratedOutput(entry.ID, original.ID, "Stale edit", original.Text); !errors.Is(err, ErrContentChanged) {
		t.Fatal("accepted an obsolete output baseline", err)
	}
	if _, err := s.UpdateGeneratedOutput("wrong-session", original.ID, "Wrong owner", output.Text); err == nil {
		t.Fatal("edited another dictation's output")
	}
	values, err := s.Revisions("output", output.ID)
	if err != nil || len(values) != 2 || values[1].Value != original.Text || values[0].Value != output.Text {
		t.Fatal("missing output versions", values, err)
	}
	for i := 0; i < 55; i++ {
		// Move the latest group's creation outside the coalescing window.
		if _, err := s.db.Exec("UPDATE revisions SET created_at=? WHERE kind='output' AND item_id=?", time.Now().Add(-11*time.Minute).UTC().Format(time.RFC3339Nano), output.ID); err != nil {
			t.Fatal(err)
		}
		output, err = s.UpdateGeneratedOutput(entry.ID, output.ID, fmt.Sprint("Edit ", i), output.Text)
		if err != nil {
			t.Fatal(err)
		}
	}
	values, err = s.Revisions("output", output.ID)
	if err != nil || len(values) != 50 {
		t.Fatal("revision retention changed", len(values), err)
	}
	for _, version := range values {
		if version.Value == original.Text {
			t.Fatal("test did not evict original from bounded history")
		}
	}
	output, err = s.UpdateGeneratedOutput(entry.ID, output.ID, output.OriginalText, output.Text)
	if err != nil || output.Edited || !reflect.DeepEqual(output, original) {
		t.Fatal("original restore depends on revision retention", output, err)
	}
	got, err := s.Session(entry.ID)
	if err != nil || !reflect.DeepEqual(got, entry) {
		t.Fatal("output editing changed transcript", got, err)
	}
}

func TestConcurrentOutputWritesHaveOneWinner(t *testing.T) {
	s, entry, output := editingFixture(t)
	results := make(chan error, 8)
	var wg sync.WaitGroup
	for i := 0; i < cap(results); i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := s.UpdateGeneratedOutput(entry.ID, output.ID, fmt.Sprint("Edit ", i), output.Text)
			results <- err
		}(i)
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrContentChanged) {
			t.Fatal("unexpected save failure", err)
		}
	}
	if successes != 1 {
		t.Fatal("concurrent saves overwrote each other", successes)
	}
}

func TestEditingNoOpsValidationAndAtomicFailure(t *testing.T) {
	s, entry, output := editingFixture(t)
	// Even an identical save must perform no content/revision SQL writes.
	for _, table := range []string{"recording_outputs", "generated_output_edits", "revisions"} {
		if _, err := s.db.Exec("CREATE TRIGGER fail_" + table + " BEFORE INSERT ON " + table + " BEGIN SELECT RAISE(ABORT,'test failure'); END"); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.UpdateTranscriptChecked(entry.ID, entry.FinalTranscript, entry.FinalTranscript); err != nil {
		t.Fatal("unchanged transcript performed writes", err)
	}
	if _, err := s.UpdateGeneratedOutput(entry.ID, output.ID, output.Text, output.Text); err != nil {
		t.Fatal("unchanged output performed writes", err)
	}
	if _, err := s.UpdateGeneratedOutput(entry.ID, output.ID, "Failed edit", output.Text); err == nil {
		t.Fatal("expected revision failure")
	}
	if err := s.UpdateTranscriptChecked(entry.ID, "Failed edit", entry.FinalTranscript); err == nil {
		t.Fatal("expected transcript failure")
	}
	if _, err := s.db.Exec("DROP TRIGGER fail_revisions"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateGeneratedOutput(entry.ID, output.ID, "Failed overlay", output.Text); err == nil {
		t.Fatal("expected overlay failure")
	}
	values, err := s.Revisions("output", output.ID)
	if err != nil || len(values) != 0 {
		t.Fatal("failed overlay committed revision history", values, err)
	}
	got, err := s.GeneratedOutput(entry.ID, output.ID)
	if err != nil || !reflect.DeepEqual(got, output) {
		t.Fatal("failed edit changed stored output", got, err)
	}
	if _, err := s.db.Exec("DROP TRIGGER fail_generated_output_edits; DROP TRIGGER fail_recording_outputs"); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"", "  ", "bad\x00text", string([]byte{0xff}), strings.Repeat("🦊", 100001)} {
		if _, err := s.UpdateGeneratedOutput(entry.ID, output.ID, invalid, output.Text); err == nil {
			t.Fatal("accepted invalid output text")
		}
		if err := s.UpdateTranscriptChecked(entry.ID, invalid, entry.FinalTranscript); err == nil {
			t.Fatal("accepted invalid transcript text")
		}
	}
	limit := strings.Repeat("🦊", 100000)
	if _, err := s.UpdateGeneratedOutput(entry.ID, output.ID, limit, output.Text); err != nil {
		t.Fatal("output limit counted bytes rather than characters", err)
	}
	if err := s.UpdateTranscriptChecked(entry.ID, limit, entry.FinalTranscript); err != nil {
		t.Fatal("transcript limit counted bytes rather than characters", err)
	}
}

func TestOutputEditingDeletionLifecycleCleansOverlaysAndVersions(t *testing.T) {
	for _, deletion := range []string{"output", "session", "legacy-delete"} {
		t.Run(deletion, func(t *testing.T) {
			s, entry, output := editingFixture(t)
			edited, err := s.UpdateGeneratedOutput(entry.ID, output.ID, "Saved edit", output.Text)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
				t.Fatal(err)
			}
			if _, err := s.UpdateGeneratedOutput(entry.ID, output.ID, "Late save", edited.Text); err == nil {
				t.Fatal("edited trashed output")
			}
			if err := s.RestoreSessions([]string{entry.ID}, time.Now()); err != nil {
				t.Fatal(err)
			}
			got, err := s.GeneratedOutput(entry.ID, output.ID)
			if err != nil || !reflect.DeepEqual(got, edited) {
				t.Fatal("trash/restore lost edit", got, err)
			}
			switch deletion {
			case "output":
				err = s.DeleteGeneratedOutput(entry.ID, output.ID)
			case "session":
				err = s.TrashSessions([]string{entry.ID}, time.Now())
				if err == nil {
					_, err = s.PermanentlyDeleteSessions([]string{entry.ID})
				}
			case "legacy-delete":
				_, err = s.db.Exec("DELETE FROM recordings WHERE id=?", entry.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.UpdateGeneratedOutput(entry.ID, output.ID, "Late save", edited.Text); err == nil {
				t.Fatal("deleted output resurrected")
			}
			var count int
			if err := s.db.QueryRow("SELECT (SELECT COUNT(*) FROM generated_output_edits)+(SELECT COUNT(*) FROM revisions WHERE kind='output')").Scan(&count); err != nil || count != 0 {
				t.Fatal("deletion left private edit data", count, err)
			}
		})
	}
}

func TestEditedOutputBackupRestoreAndLegacyArchives(t *testing.T) {
	s, entry, original := editingFixture(t)
	edited, err := s.UpdateGeneratedOutput(entry.ID, original.ID, "Current edited output", original.Text)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "edited.zip")
	if _, err := s.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	if _, err := dest.RestoreBackup(context.Background(), archive, false); err != nil {
		t.Fatal(err)
	}
	got, err := dest.GeneratedOutput(entry.ID, original.ID)
	if err != nil || !reflect.DeepEqual(got, edited) {
		t.Fatal("backup lost original/current output", got, err)
	}
	versions, err := dest.Revisions("output", original.ID)
	if err != nil || len(versions) != 0 {
		t.Fatal("backup unexpectedly exported revision archive", versions, err)
	}
	// An old manifest has neither additional field. Its saved Text becomes the
	// original without inventing an edit or generation history.
	data, err := json.Marshal(archive.manifest)
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]any
	if err := json.Unmarshal(data, &legacy); err != nil {
		t.Fatal(err)
	}
	for _, item := range legacy["outputs"].([]any) {
		delete(item.(map[string]any), "originalText")
		delete(item.(map[string]any), "edited")
	}
	legacyPath := filepath.Join(t.TempDir(), "legacy.zip")
	writeBackupArchive(t, legacyPath, legacy, nil)
	legacyArchive, err := ReadBackup(context.Background(), legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	defer legacyArchive.Close()
	legacyDest := backupStore(t)
	if _, err := legacyDest.RestoreBackup(context.Background(), legacyArchive, false); err != nil {
		t.Fatal(err)
	}
	got, err = legacyDest.GeneratedOutput(entry.ID, original.ID)
	if err != nil || got.Text != edited.Text || got.OriginalText != edited.Text || got.Edited {
		t.Fatal("legacy archive received invented original/edit", got, err)
	}
}

func TestOutputEditsNeverInferCitationsFromNewMarkers(t *testing.T) {
	s := backupStore(t)
	entry := NewSession("chat-edit", 100, "First passage.\nSecond passage.", "base", "en", "")
	config := textmodel.Defaults()
	config.Model = "local-model"
	output := NewGeneratedOutput(entry.ID, entry.RawTranscript, "Original answer [[1]]", config, textmodel.Prompt{ID: "chat", Name: "Chat", Instruction: "Saved reply"})
	if err := s.AddWithOutputs(entry, []GeneratedOutput{output}); err != nil {
		t.Fatal(err)
	}
	before, err := s.GeneratedOutput(entry.ID, output.ID)
	if err != nil || before.Citations == nil || len(before.Citations.References) != 1 {
		t.Fatal("legacy reference recovery failed", before, err)
	}
	edited, err := s.UpdateGeneratedOutput(entry.ID, output.ID, "New claim [[2]]", output.Text)
	if err != nil || !reflect.DeepEqual(edited.Citations, before.Citations) {
		t.Fatal("edit changed reference metadata", edited, err)
	}
	got, err := s.GeneratedOutput(entry.ID, output.ID)
	if err != nil || !reflect.DeepEqual(got.Citations, before.Citations) {
		t.Fatal("reload inferred citations from edited text", got, err)
	}
}

func TestOutputEditOverlayKeepsLegacyWritesCompatibleAndSurvivesReopen(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	entry := NewSession("legacy-output", 1000, "Original speech", "base", "en", "")
	if err := s.Add(entry); err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Model = "local-model"
	original := NewGeneratedOutput(entry.ID, entry.RawTranscript, "Original generated text", config, config.Prompts[0])
	// Positional output inserts made by older builds still use the original
	// table shape and do not know about the edit overlay or new API fields.
	if _, err := s.db.Exec("INSERT INTO generated_outputs VALUES(?,?,?,?,?,?,?,?,?,?)", original.ID, original.SessionID, original.CreatedAt, original.Prompt.ID, original.Prompt.Name, original.Prompt.Instruction, original.Model, original.Endpoint, original.Input, original.Text); err != nil {
		t.Fatal("legacy output insert incompatible", err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GeneratedOutput(entry.ID, original.ID)
	if err != nil || !reflect.DeepEqual(got, original) {
		t.Fatal("legacy original not projected correctly", got, err)
	}
	edited, err := s.UpdateGeneratedOutput(entry.ID, original.ID, "Persistent edit", original.Text)
	if err != nil {
		t.Fatal(err)
	}
	var storedOriginal string
	if err := s.db.QueryRow("SELECT output FROM generated_outputs WHERE id=?", original.ID).Scan(&storedOriginal); err != nil || storedOriginal != original.Text {
		t.Fatal("editing mutated immutable generation row", storedOriginal, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err = s.GeneratedOutput(entry.ID, original.ID)
	if err != nil || !reflect.DeepEqual(got, edited) {
		t.Fatal("reopening lost original/current text", got, err)
	}
}
