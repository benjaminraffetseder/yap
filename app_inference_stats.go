package main

import (
	"context"
	"time"

	textmodel "yap/internal/inference/text"
)

// Existing engines remain usable; the local HTTP engine also supplies optional
// provider metadata without changing the processing request or result text.
func (a *App) processWithStats(ctx context.Context, config textmodel.Config, prompt textmodel.Prompt, input string) (string, *textmodel.Stats, error) {
	if engine, ok := a.textEngine.(interface {
		ProcessWithStats(context.Context, textmodel.Config, textmodel.Prompt, string) (string, *textmodel.Stats, error)
	}); ok {
		return engine.ProcessWithStats(ctx, config, prompt, input)
	}
	started := time.Now()
	output, err := a.textEngine.Process(ctx, config, prompt, input)
	if err != nil {
		return output, nil, err
	}
	elapsed := float64(time.Since(started)) / float64(time.Millisecond)
	return output, &textmodel.Stats{DurationMS: elapsed, ResponseMS: elapsed, Model: config.Model, Attempts: 1}, nil
}
