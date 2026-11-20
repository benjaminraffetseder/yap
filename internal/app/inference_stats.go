package app

import (
	"context"

	"yap/internal/app/textprocessing"
	textmodel "yap/internal/inference/text"
)

// Existing engines remain usable; the local HTTP engine also supplies optional
// provider metadata without changing the processing request or result text.
func (a *App) processWithStats(ctx context.Context, config textmodel.Config, prompt textmodel.Prompt, input string) (string, *textmodel.Stats, error) {
	return textprocessing.ProcessWithStats(ctx, a.textEngine, config, prompt, input)
}
