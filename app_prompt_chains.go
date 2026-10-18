package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

// Called without a.mu. Each completed step is committed before its dependents
// start. save runs under a.mu, alongside cancellation/deletion checks.
func (a *App) runTextRecipe(ctx context.Context, config textmodel.Config, recipe textmodel.Chain, session storage.Session, save func(storage.GeneratedOutput) error) (string, error) {
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
		a.mu.Lock()
		if a.closing || ctx.Err() != nil {
			a.mu.Unlock()
			return "", context.Canceled
		}
		a.status.Message = fmt.Sprintf("Step %d of %d · %s", i+1, len(recipe.Steps), prompt.Name)
		a.emit()
		a.mu.Unlock()
		result, err = a.textEngine.Process(ctx, config, prompt, input)
		if err == nil {
			err = textmodel.ValidateText(result)
		}
		a.mu.Lock()
		if a.closing || ctx.Err() != nil {
			a.mu.Unlock()
			return "", context.Canceled
		}
		if err == nil {
			output := storage.NewGeneratedOutput(session.ID, input, result, config, prompt)
			if recipe.ID != "" {
				output.Chain = storage.OutputChain{RunID: runID, ChainID: recipe.ID, Name: recipe.Name, StepID: step.ID, Step: i + 1, Total: len(recipe.Steps), Input: step.Input, SourceOutputID: sourceID}
			}
			err = save(output)
			if err == nil {
				completed[step.ID] = output
				a.event("dictation:history")
				a.emit()
			}
		}
		a.mu.Unlock()
		if err != nil {
			return "", fmt.Errorf("step %d (%s): %w; completed results are kept", i+1, prompt.Name, err)
		}
	}
	return result, nil
}
