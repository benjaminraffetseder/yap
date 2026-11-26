package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

type selectionPreviewEngine struct {
	prompt textmodel.Prompt
	input  string
	start  chan struct{}
}

func (e *selectionPreviewEngine) Process(ctx context.Context, _ textmodel.Config, prompt textmodel.Prompt, input string) (string, error) {
	e.prompt, e.input = prompt, input
	if e.start != nil {
		close(e.start)
		<-ctx.Done()
		return "", ctx.Err()
	}
	return "Refined selected passage.", nil
}

func (*selectionPreviewEngine) Refine(context.Context, textmodel.Config, string) (string, error) {
	return "", errors.New("selection refinement used prompt-authoring route")
}

func TestSelectionRefinementIsUnsavedPreviewWithBuiltInPreset(t *testing.T) {
	a := testApp(t)
	a.textConfig = textmodel.Config{Enabled: true, Endpoint: "http://127.0.0.1:11434/v1", Model: "local"}
	engine := &selectionPreviewEngine{}
	a.textEngine = engine
	if err := a.store.Add(storage.NewSession("one", 1000, "Original transcript.", "tiny", "en", "")); err != nil {
		t.Fatal(err)
	}
	result, err := a.RefineSelection("selection-test", "proofread", "Selected passage.", "Before.", "After.")
	if err != nil || result != "Refined selected passage." {
		t.Fatal(result, err)
	}
	if engine.input != "Selected passage." || engine.prompt.ID != "selection-proofread" || !strings.Contains(engine.prompt.Instruction, "minimal changes") {
		t.Fatal("lost selection or preset", engine)
	}
	entry, err := a.store.Session("one")
	outputs, outputErr := a.store.GeneratedOutputs("one")
	if err != nil || outputErr != nil || entry.FinalTranscript != "Original transcript." || len(outputs) != 0 || a.textJobID != "" {
		t.Fatal("preview mutated history or leaked job", entry, outputs, err, outputErr)
	}
}

func TestSelectionRefinementCancellationNeverProducesReplacement(t *testing.T) {
	a := testApp(t)
	a.textConfig = textmodel.Config{Enabled: true, Endpoint: "http://127.0.0.1:11434/v1", Model: "local"}
	engine := &selectionPreviewEngine{start: make(chan struct{})}
	a.textEngine = engine
	finished := make(chan error, 1)
	go func() {
		_, err := a.RefineSelection("selection-cancel", "rewrite", "Selected.", "", "")
		finished <- err
	}()
	<-engine.start
	a.CancelTextProcessing("selection-cancel")
	if err := <-finished; !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation returned usable result", err)
	}
	if a.textJobID != "" {
		t.Fatal("selection job leaked ownership")
	}
	a.CancelTextProcessing("early-selection")
	if _, err := a.RefineSelection("early-selection", "concise", "Selected.", "", ""); !errors.Is(err, context.Canceled) {
		t.Fatal("early cancellation was ignored", err)
	}
}
