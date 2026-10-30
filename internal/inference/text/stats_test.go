package text

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProcessWithStatsPreservesUsageAndServerSpeed(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if requests == 1 {
			fmt.Fprint(w, `{"choices":[{"message":{"content":"partial"},"finish_reason":"length"}],"usage":{"completion_tokens":4096}}`)
			return
		}
		fmt.Fprint(w, `{"model":"actual-model","choices":[{"message":{"content":" complete "},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":10}},"timings":{"predicted_per_second":42.5}}`)
	}))
	defer server.Close()
	output, stats, err := (Local{}).ProcessWithStats(context.Background(), Config{Enabled: true, Model: "requested", Endpoint: server.URL + "/v1"}, Prompt{Instruction: "Summarize"}, "Transcript")
	if err != nil || output != "complete" || stats == nil || !stats.Valid() {
		t.Fatal(output, stats, err)
	}
	if stats.Attempts != 2 || stats.Model != "actual-model" || stats.FinishReason != "stop" || stats.DurationMS < stats.ResponseMS || stats.ResponseMS < 0 {
		t.Fatal("incorrect retry timing or identity", stats)
	}
	if stats.InputTokens == nil || *stats.InputTokens != 100 || stats.OutputTokens == nil || *stats.OutputTokens != 50 || stats.TotalTokens == nil || *stats.TotalTokens != 150 || stats.CachedInputTokens == nil || *stats.CachedInputTokens != 0 || stats.ReasoningTokens == nil || *stats.ReasoningTokens != 10 || stats.GenerationTokensPerSecond == nil || *stats.GenerationTokensPerSecond != 42.5 {
		t.Fatal("lost response metadata", stats)
	}
}

func TestOptionalMetadataDoesNotBreakTextOrInventUsage(t *testing.T) {
	for _, extra := range []string{
		``,
		`,"usage":null`,
		`,"usage":"unsupported","timings":{"predicted_per_second":"unknown"}`,
		`,"usage":{"prompt_tokens":-1,"completion_tokens":-1,"total_tokens":-1},"timings":{"predicted_per_second":-2}`,
	} {
		t.Run(extra, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, `{"choices":[{"message":{"content":"result"}}]%s}`, extra)
			}))
			defer server.Close()
			output, stats, err := (Local{}).ProcessWithStats(context.Background(), Config{Enabled: true, Model: "local", Endpoint: server.URL + "/v1"}, Prompt{Instruction: "Summarize"}, "Transcript")
			if err != nil || output != "result" || stats == nil || !stats.Valid() || stats.OutputTokens != nil || stats.InputTokens != nil || stats.TotalTokens != nil || stats.GenerationTokensPerSecond != nil || stats.Attempts != 1 || stats.Model != "local" {
				t.Fatal("optional metadata changed the result", output, stats, err)
			}
		})
	}
}
