package textprocessing

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

// RecipeHooks let the host check cancellation and publish progress under its
// lock. CommitStep must call commit synchronously under the same lock as its
// cancellation/deletion checks, and must skip it when the job was interrupted.
// The commit saves exactly one result before a dependent step can begin.
type RecipeHooks struct {
	Progress   func(string) error
	CommitStep func(commit func() error) error
	Transient  bool
}

func RunRecipe(ctx context.Context, engine textmodel.Engine, config textmodel.Config, recipe textmodel.Chain, session storage.Session, save func(storage.GeneratedOutput) error, hooks RecipeHooks) (string, error) {
	runID := uuid.NewString()
	completed := make(map[string]storage.GeneratedOutput, len(recipe.Steps))
	var result string
	for i, step := range recipe.Steps {
		input, sourceID := session.FinalTranscript, ""
		switch {
		case step.Input == "original":
			input = session.RawTranscript
		case strings.HasPrefix(step.Input, "step:"):
			source, ok := completed[strings.TrimPrefix(step.Input, "step:")]
			if !ok {
				return "", fmt.Errorf("%s step %d: input step is unavailable", recipe.Name, i+1)
			}
			input, sourceID = source.Text, source.ID
		}
		prompt, err := config.Prompt(step.PromptID)
		if err != nil {
			return "", err
		}
		if err := textmodel.ValidateText(input); err != nil {
			return "", fmt.Errorf("step %d (%s): %w", i+1, prompt.Name, err)
		}
		if err := hooks.Progress(fmt.Sprintf("Step %d of %d · %s", i+1, len(recipe.Steps), prompt.Name)); err != nil {
			return "", err
		}
		var stats *textmodel.Stats
		result, stats, err = ProcessWithStats(ctx, engine, config, prompt, input)
		if err == nil {
			err = textmodel.ValidateText(result)
		}
		if err := hooks.CommitStep(func() error {
			if err == nil {
				output := storage.NewGeneratedOutput(session.ID, input, result, config, prompt)
				output.Stats = stats
				if recipe.ID != "" {
					output.Chain = storage.OutputChain{RunID: runID, ChainID: recipe.ID, Name: recipe.Name, StepID: step.ID, Step: i + 1, Total: len(recipe.Steps), Input: step.Input, SourceOutputID: sourceID}
				}
				err = save(output)
				if err == nil {
					completed[step.ID] = output
				}
			}
			if err != nil {
				if hooks.Transient {
					return fmt.Errorf("step %d (%s): %w", i+1, prompt.Name, err)
				}
				return fmt.Errorf("step %d (%s): %w; completed results are kept", i+1, prompt.Name, err)
			}
			return nil
		}); err != nil {
			return "", err
		}
	}
	return result, nil
}
