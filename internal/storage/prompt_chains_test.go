package storage

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"

	textmodel "yap/internal/inference/text"
)

func TestChainsAndStepLineageSurviveRestartAndBackup(t *testing.T) {
	dir := t.TempDir()
	source, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Enabled, config.Model, config.AutoPromptID = true, "local", "notes"
	config.Chains = []textmodel.Chain{{ID: "notes", Name: "Notes", Steps: []textmodel.ChainStep{
		{ID: "a", PromptID: "cleanup", Input: "original"},
		{ID: "b", PromptID: "summary", Input: "step:a"},
	}}}
	if err := source.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	entry := NewSession("one", 100, "Original", "base", "en", "")
	first := NewGeneratedOutput(entry.ID, "Original", "Cleaned", config, config.Prompts[0])
	first.CreatedAt = "2026-10-15T12:00:00.000000000Z"
	first.Chain = OutputChain{RunID: "run", ChainID: "notes", Name: "Notes", StepID: "a", Step: 1, Total: 2, Input: "original"}
	second := NewGeneratedOutput(entry.ID, "Cleaned", "Summary", config, config.Prompts[1])
	second.CreatedAt = "2026-10-15T12:00:01.000000000Z"
	second.Chain = OutputChain{RunID: "run", ChainID: "notes", Name: "Notes", StepID: "b", Step: 2, Total: 2, Input: "step:a", SourceOutputID: first.ID}
	if err := source.AddWithOutputs(entry, []GeneratedOutput{first, second}); err != nil {
		t.Fatal(err)
	}
	source.Close()
	source, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	saved, err := source.TextProcessing()
	if err != nil || !reflect.DeepEqual(saved, config) {
		t.Fatal("lost chains on restart", saved, err)
	}
	outputs, err := source.GeneratedOutputs(entry.ID)
	if err != nil || len(outputs) != 2 || outputs[0] != second || outputs[1] != first {
		t.Fatal("lost step lineage on restart", outputs, err)
	}
	path := filepath.Join(t.TempDir(), "chains.zip")
	if summary, err := source.ExportBackup(context.Background(), path, false); err != nil || summary.Chains != 1 {
		t.Fatal(summary, err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	restored, err := dest.RestoreBackup(context.Background(), archive, false)
	if err != nil || restored.Summary.Chains != 1 || !reflect.DeepEqual(restored.TextProcessing.Chains, config.Chains) {
		t.Fatal("lost chain in backup", restored, err)
	}
	got, err := dest.GeneratedOutputs(entry.ID)
	if err != nil || !reflect.DeepEqual(got, outputs) {
		t.Fatal("lost lineage in backup", got, err)
	}
	if summary, err := dest.PreviewBackup(context.Background(), archive); err != nil || summary.Chains != 0 || summary.SkippedChains != 1 {
		t.Fatal("duplicate chain not skipped", summary, err)
	}
	// Deleting one source preserves the descendant's captured input.
	if err := dest.DeleteGeneratedOutput(entry.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	remaining, err := dest.GeneratedOutput(entry.ID, second.ID)
	if err != nil || remaining != second {
		t.Fatal("deleting source changed descendant", remaining, err)
	}
	var count int
	if err := dest.db.QueryRow("SELECT COUNT(*) FROM generated_output_chains WHERE output_id=?", first.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("orphaned lineage", count, err)
	}
}
