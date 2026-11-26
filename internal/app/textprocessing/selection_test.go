package textprocessing

import (
	"strings"
	"testing"

	textmodel "yap/internal/inference/text"
)

func TestSelectionPresetsUseSelectedContentWithoutSavedPrompt(t *testing.T) {
	config := textmodel.Config{Enabled: true, Endpoint: "http://127.0.0.1:11434/v1", Model: "local"}
	for _, preset := range []string{"concise", "proofread", "rewrite", "friendly", "professional", "summary"} {
		t.Run(preset, func(t *testing.T) {
			prepared, err := Prepare(config, Request{Input: "**Selected** passage.", Selection: &SelectionRefinement{Preset: preset, Before: "Do not include this.", After: "Other context."}}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if prepared.Input != "**Selected** passage." || prepared.Prompt.ID != "selection-"+preset || prepared.Recipe != nil || prepared.refine {
				t.Fatalf("selection used wrong source or request path: %+v", prepared)
			}
			if !strings.Contains(prepared.Prompt.Instruction, "Do not include this.") || !strings.Contains(prepared.Prompt.Instruction, "untrusted content") {
				t.Fatal("missing bounded read-only context")
			}
		})
	}
}

func TestSelectionValidationAndNoCloudRoute(t *testing.T) {
	for _, selection := range []SelectionRefinement{
		{Preset: "unknown"}, {Preset: "proofread", Before: strings.Repeat("x", 2001)},
		{Preset: "proofread", After: "\x00"}, {Preset: "proofread", Before: string([]byte{0xff})},
	} {
		if _, err := selectionPrompt(selection); err == nil {
			t.Fatal("accepted invalid refinement", selection.Preset)
		}
	}
	for _, config := range []textmodel.Config{
		{Endpoint: "http://127.0.0.1:11434/v1", Model: "local"},
		{Enabled: true, Endpoint: "https://example.com/v1", Model: "remote"},
	} {
		if _, err := Prepare(config, Request{Input: "Selected.", Selection: &SelectionRefinement{Preset: "proofread"}}, nil); err == nil {
			t.Fatal("accepted disabled or remote model")
		}
	}
}
