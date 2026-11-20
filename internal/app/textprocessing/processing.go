// Package textprocessing prepares and runs text transformations independently of
// the application's job ownership, synchronization, and event publication.
package textprocessing

import (
	"context"
	"time"

	textmodel "yap/internal/inference/text"
)

// ProcessWithStats preserves metadata supplied by an engine and measures older
// engines without changing their request or response text.
func ProcessWithStats(ctx context.Context, engine textmodel.Engine, config textmodel.Config, prompt textmodel.Prompt, input string) (string, *textmodel.Stats, error) {
	if measured, ok := engine.(interface {
		ProcessWithStats(context.Context, textmodel.Config, textmodel.Prompt, string) (string, *textmodel.Stats, error)
	}); ok {
		return measured.ProcessWithStats(ctx, config, prompt, input)
	}
	started := time.Now()
	output, err := engine.Process(ctx, config, prompt, input)
	if err != nil {
		return output, nil, err
	}
	elapsed := float64(time.Since(started)) / float64(time.Millisecond)
	return output, &textmodel.Stats{DurationMS: elapsed, ResponseMS: elapsed, Model: config.Model, Attempts: 1}, nil
}

// ConnectionChanged determines whether saving normalized settings must release
// the active model connection.
func ConnectionChanged(previous, next textmodel.Config) bool {
	return previous.Provider != next.Provider || previous.Model != next.Model || previous.ContextLength != next.ContextLength || !next.Enabled
}
