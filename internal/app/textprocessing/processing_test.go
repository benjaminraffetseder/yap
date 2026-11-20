package textprocessing

import (
	"context"
	"errors"
	"testing"

	textmodel "yap/internal/inference/text"
)

type measuredEngine struct {
	processFunc
	stats *textmodel.Stats
	err   error
}

func (e measuredEngine) ProcessWithStats(context.Context, textmodel.Config, textmodel.Prompt, string) (string, *textmodel.Stats, error) {
	return "provider response", e.stats, e.err
}

func TestProcessingPreservesProviderMeasurementsIncludingErrors(t *testing.T) {
	stats := &textmodel.Stats{DurationMS: 42, ResponseMS: 15, Model: "reported-model", Attempts: 3}
	providerError := errors.New("provider failed")
	for _, wantError := range []error{nil, providerError} {
		engine := measuredEngine{stats: stats, err: wantError}
		output, got, err := ProcessWithStats(context.Background(), engine, textmodel.Config{Model: "configured-model"}, textmodel.Prompt{}, "Speech")
		if output != "provider response" || got != stats || err != wantError {
			t.Fatal("changed provider response or replaced its metadata", output, got, err)
		}
	}
}

func TestProcessingMeasuresLegacySuccessAndPreservesErrorResponse(t *testing.T) {
	providerError := errors.New("offline")
	for _, wantError := range []error{nil, providerError} {
		engine := processFunc(func(context.Context, textmodel.Config, textmodel.Prompt, string) (string, error) {
			return "engine response", wantError
		})
		output, stats, err := ProcessWithStats(context.Background(), engine, textmodel.Config{Model: "configured-model"}, textmodel.Prompt{}, "Speech")
		if output != "engine response" || err != wantError {
			t.Fatal(output, err)
		}
		if wantError != nil {
			if stats != nil {
				t.Fatal("legacy error acquired fabricated metadata", stats)
			}
		} else if stats == nil || stats.Model != "configured-model" || stats.Attempts != 1 || stats.DurationMS < 0 || stats.DurationMS != stats.ResponseMS {
			t.Fatal("missing fallback measurements", stats)
		}
	}
}
