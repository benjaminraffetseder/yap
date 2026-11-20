package textprocessing

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

type processFunc func(context.Context, textmodel.Config, textmodel.Prompt, string) (string, error)

func (f processFunc) Process(ctx context.Context, c textmodel.Config, p textmodel.Prompt, input string) (string, error) {
	return f(ctx, c, p, input)
}

func (processFunc) Refine(context.Context, textmodel.Config, string) (string, error) {
	panic("unexpected refinement")
}

func recipeConfig() (textmodel.Config, textmodel.Chain) {
	c := textmodel.Defaults()
	c.Enabled, c.Model = true, "local-model"
	return c, textmodel.Chain{ID: "follow-up", Name: "Follow-up", Steps: []textmodel.ChainStep{
		{ID: "clean", PromptID: "cleanup", Input: "original"},
		{ID: "summarize", PromptID: "summary", Input: "step:clean"},
	}}
}

func TestRecipeCommitsBeforeDependentsAndPreservesSourceSnapshots(t *testing.T) {
	config, recipe := recipeConfig()
	session := storage.Session{ID: "session", RawTranscript: "Original speech", FinalTranscript: "Edited speech"}
	var saved []storage.GeneratedOutput
	var order []string
	engine := processFunc(func(_ context.Context, c textmodel.Config, p textmodel.Prompt, input string) (string, error) {
		order = append(order, "process:"+p.ID)
		if c.Model != config.Model {
			t.Fatal("lost connection snapshot", c)
		}
		if len(saved) == 0 {
			if input != session.RawTranscript {
				t.Fatal("first step did not read original speech", input)
			}
			return "Cleaned speech", nil
		}
		if input != saved[0].Text {
			t.Fatal("dependent step did not use committed output", input)
		}
		return "Summary", nil
	})
	hooks := RecipeHooks{
		Progress: func(message string) error { order = append(order, message); return nil },
		CommitStep: func(commit func() error) error {
			order = append(order, "commit")
			return commit()
		},
	}
	result, err := RunRecipe(context.Background(), engine, config, recipe, session, func(output storage.GeneratedOutput) error {
		saved = append(saved, output)
		return nil
	}, hooks)
	if err != nil || result != "Summary" || len(saved) != 2 {
		t.Fatal(result, saved, err)
	}
	wantOrder := []string{"Step 1 of 2 · Cleanup", "process:cleanup", "commit", "Step 2 of 2 · Summary", "process:summary", "commit"}
	if !reflect.DeepEqual(order, wantOrder) {
		t.Fatal("changed progress/commit ordering", order)
	}
	first, second := saved[0], saved[1]
	if first.Input != session.RawTranscript || second.Input != first.Text || first.SessionID != session.ID || second.SessionID != session.ID || first.ID == second.ID {
		t.Fatal("lost independent source snapshots", saved)
	}
	if first.Chain.RunID == "" || second.Chain.RunID != first.Chain.RunID || second.Chain.SourceOutputID != first.ID || first.Chain.SourceOutputID != "" || second.Chain.Step != 2 || second.Chain.Total != 2 || second.Chain.StepID != "summarize" || second.Chain.ChainID != recipe.ID || second.Chain.Name != recipe.Name || second.Chain.Input != "step:clean" {
		t.Fatal("lost chain provenance", saved)
	}
	for _, output := range saved {
		if output.Stats == nil || output.Stats.Model != config.Model || output.Stats.Attempts != 1 {
			t.Fatal("lost per-step measurements", output)
		}
	}
}

func TestRecipeKeepsCompletedStepsAndCancellationPrecedesStepErrors(t *testing.T) {
	for _, mode := range []string{"engine", "invalid", "save", "engine-canceled", "cancel-engine", "cancel-invalid", "cancel-success"} {
		t.Run(mode, func(t *testing.T) {
			config, recipe := recipeConfig()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			saved, calls := 0, 0
			engine := processFunc(func(context.Context, textmodel.Config, textmodel.Prompt, string) (string, error) {
				calls++
				if calls == 1 {
					return "Completed", nil
				}
				switch mode {
				case "cancel-engine", "cancel-invalid", "cancel-success":
					cancel()
				}
				switch mode {
				case "engine", "cancel-engine":
					return "Partial response", errors.New("offline")
				case "invalid", "cancel-invalid":
					return "", nil
				case "engine-canceled":
					return "", context.Canceled
				default:
					return "Late result", nil
				}
			})
			hooks := RecipeHooks{
				Progress: func(string) error { return nil },
				CommitStep: func(commit func() error) error {
					if ctx.Err() != nil {
						return context.Canceled
					}
					return commit()
				},
			}
			result, err := RunRecipe(ctx, engine, config, recipe, storage.Session{ID: "session", RawTranscript: "Speech"}, func(storage.GeneratedOutput) error {
				if saved == 1 && mode == "save" {
					return context.Canceled // A storage error retains step context.
				}
				saved++
				return nil
			}, hooks)
			if result != "" || err == nil || calls != 2 || saved != 1 {
				t.Fatal("lost completed result or continued past failure", result, err, calls, saved)
			}
			if ctx.Err() != nil {
				if err != context.Canceled {
					t.Fatal("cancellation lost precedence", err)
				}
				return
			}
			failure := map[string]string{"engine": "offline", "invalid": "text must contain between 1 and 100,000 characters without null bytes", "save": context.Canceled.Error(), "engine-canceled": context.Canceled.Error()}[mode]
			want := fmt.Sprintf("step 2 (Summary): %s; completed results are kept", failure)
			if err.Error() != want {
				t.Fatalf("error changed: %q, want %q", err, want)
			}
		})
	}
}
