package textprocessing

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
)

// Opt-in local smoke test: reuse installed weights/runtime, never download or
// read user history/configuration. Responses contain only synthetic passages.
func TestSelectionRefinementLiveLocalModel(t *testing.T) {
	dir := os.Getenv("YAP_REFINEMENT_MODEL_DIR")
	if dir == "" {
		t.Skip("set YAP_REFINEMENT_MODEL_DIR to an existing Yap data directory")
	}
	model := os.Getenv("YAP_REFINEMENT_MODEL")
	if model == "" {
		model = "gemma-4-e2b"
	}
	engine := &textmodel.Managed{Dir: dir}
	defer engine.Close()
	config := textmodel.Config{Enabled: true, Provider: "builtin", Model: model, ContextLength: 8192}
	for _, sample := range []struct{ language, text string }{
		{"en", "Mara will sends the 3 draft report to Leo by Friday. The budget are 120 euros. Please confirm next steps."},
		{"de", "Mara schickt Leo bis Freitag die 3 Entwurf. Das Budget sind 120 Euro. Bitte bestätige nächste Schritte."},
	} {
		for _, preset := range []string{"concise", "proofread", "rewrite", "friendly", "professional", "summary"} {
			t.Run(sample.language+"/"+preset, func(t *testing.T) {
				prepared, err := Prepare(config, Request{Input: sample.text, Selection: &SelectionRefinement{Preset: preset}}, nil)
				if err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
				defer cancel()
				started := time.Now()
				output, _, err := prepared.Run(ctx, engine, nil, RecipeHooks{})
				if err != nil {
					t.Fatal(err)
				}
				t.Logf("%s (%s): %s", model, time.Since(started).Round(time.Millisecond), output)
				for _, fact := range []string{"Mara", "Leo", "3", "120"} {
					if !strings.Contains(output, fact) {
						t.Errorf("replacement lost a central synthetic fact %q", fact)
					}
				}
			})
		}
	}
}
