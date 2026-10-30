package text

import (
	"encoding/json"
	"math"
	"strings"
)

// Stats describes one completed transformation. Usage and response timing refer
// to the final attempt; DurationMS includes any discarded, truncated attempts.
// Pointers distinguish an unavailable metric from a provider-reported zero.
type Stats struct {
	DurationMS                float64  `json:"durationMs"`
	ResponseMS                float64  `json:"responseMs"`
	Attempts                  int      `json:"attempts"`
	Model                     string   `json:"model"`
	FinishReason              string   `json:"finishReason,omitempty"`
	InputTokens               *int     `json:"inputTokens,omitempty"`
	OutputTokens              *int     `json:"outputTokens,omitempty"`
	TotalTokens               *int     `json:"totalTokens,omitempty"`
	CachedInputTokens         *int     `json:"cachedInputTokens,omitempty"`
	ReasoningTokens           *int     `json:"reasoningTokens,omitempty"`
	GenerationTokensPerSecond *float64 `json:"generationTokensPerSecond,omitempty"`
}

type chatUsage struct {
	PromptTokens     *int `json:"prompt_tokens"`
	CompletionTokens *int `json:"completion_tokens"`
	TotalTokens      *int `json:"total_tokens"`
	PromptDetails    struct {
		CachedTokens *int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
	CompletionDetails struct {
		ReasoningTokens *int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
}

func tokenCount(v *int) *int {
	if v != nil && *v >= 0 {
		return v
	}
	return nil
}

func responseStats(data []byte, model, reason string, duration, response float64, attempts int) Stats {
	stats := Stats{DurationMS: duration, ResponseMS: response, Attempts: attempts, Model: model}
	if len(reason) <= 80 && !strings.ContainsAny(reason, "\r\n\x00") {
		stats.FinishReason = reason
	}
	var metadata struct {
		Model   string          `json:"model"`
		Usage   json.RawMessage `json:"usage"`
		Timings json.RawMessage `json:"timings"`
	}
	_ = json.Unmarshal(data, &metadata)
	if name := strings.TrimSpace(metadata.Model); name != "" && len(name) <= 200 && !strings.ContainsAny(name, "\r\n\x00") {
		stats.Model = name
	}
	var usage chatUsage
	if json.Unmarshal(metadata.Usage, &usage) == nil {
		stats.InputTokens, stats.OutputTokens, stats.TotalTokens = tokenCount(usage.PromptTokens), tokenCount(usage.CompletionTokens), tokenCount(usage.TotalTokens)
		stats.CachedInputTokens, stats.ReasoningTokens = tokenCount(usage.PromptDetails.CachedTokens), tokenCount(usage.CompletionDetails.ReasoningTokens)
	}
	// llama.cpp (and compatible servers) optionally includes decode throughput.
	// Keep it separate from output tokens / elapsed request time.
	var timings struct {
		PredictedPerSecond *float64 `json:"predicted_per_second"`
	}
	if json.Unmarshal(metadata.Timings, &timings) == nil && timings.PredictedPerSecond != nil && finiteNonnegative(*timings.PredictedPerSecond) {
		stats.GenerationTokensPerSecond = timings.PredictedPerSecond
	}
	return stats
}

func finiteNonnegative(v float64) bool { return v >= 0 && !math.IsInf(v, 0) && !math.IsNaN(v) }

func (s *Stats) Valid() bool {
	if s == nil {
		return true
	}
	if !finiteNonnegative(s.DurationMS) || !finiteNonnegative(s.ResponseMS) || s.ResponseMS > s.DurationMS || s.Attempts < 1 || s.Attempts > 4 || len(s.Model) > 200 || len(s.FinishReason) > 80 || strings.ContainsAny(s.Model+s.FinishReason, "\r\n\x00") {
		return false
	}
	for _, n := range []*int{s.InputTokens, s.OutputTokens, s.TotalTokens, s.CachedInputTokens, s.ReasoningTokens} {
		if n != nil && *n < 0 {
			return false
		}
	}
	return s.GenerationTokensPerSecond == nil || finiteNonnegative(*s.GenerationTokensPerSecond)
}
