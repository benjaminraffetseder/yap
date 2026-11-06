package text

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

var ErrChatContext = errors.New("the transcript and conversation exceed the model's context window; use a larger context window or a shorter transcript")

// Chat keeps the same loopback-only transport as transcript processing. A nil
// callback requests a non-streamed response (used for conversation compaction).
func (Local) Chat(ctx context.Context, config Config, messages []Message, onText func(string)) (string, error) {
	config, err := Normalize(config)
	if err != nil {
		return "", err
	}
	if !config.Enabled {
		return "", errors.New("enable a local text model in Prompts first")
	}
	if len(messages) == 0 {
		return "", errors.New("chat needs a message")
	}
	u, _ := Endpoint(config.Endpoint)
	u.Path += "/chat/completions"
	budget := 2048
	if config.Provider == "builtin" && config.ContextLength > 0 {
		budget = min(budget, config.ContextLength/2)
	}
	body, err := json.Marshal(map[string]any{"model": config.Model, "messages": messages, "stream": onText != nil, "temperature": 0.2, "max_tokens": budget})
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	client, closeClient := localHTTPClient(5 * time.Minute)
	defer closeClient()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+config.APIKey)
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", errors.New("could not reach the local model; start its server and check the URL")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Classify context errors without echoing a server body containing text.
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 65536))
		lower := strings.ToLower(string(data))
		if (resp.StatusCode == 400 || resp.StatusCode == 413) && (strings.Contains(lower, "context") || strings.Contains(lower, "token")) {
			return "", ErrChatContext
		}
		return "", fmt.Errorf("local model returned HTTP %d; check the model and server", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		data, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
		if err != nil {
			return "", err
		}
		if len(data) > 2*1024*1024 {
			return "", errors.New("local model response is too large")
		}
		var result struct {
			Choices []struct {
				Message      Message `json:"message"`
				FinishReason string  `json:"finish_reason"`
			} `json:"choices"`
		}
		if json.Unmarshal(data, &result) != nil || len(result.Choices) == 0 {
			return "", errors.New("local model returned an invalid chat response")
		}
		output := strings.TrimSpace(result.Choices[0].Message.Content)
		if err := ValidateText(output); err != nil {
			return "", errors.New("local model returned empty or invalid text")
		}
		if onText != nil {
			onText(output)
		}
		if result.Choices[0].FinishReason == "length" {
			return output, errors.New("the reply reached the model's output limit; retry with a request for a shorter answer")
		}
		return output, nil
	}
	var output strings.Builder
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, 4*1024*1024))
	scanner.Buffer(make([]byte, 4096), 2*1024*1024)
	finished, truncated := false, false
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			finished = true
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			return output.String(), errors.New("local model returned an invalid chat stream")
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		choice := chunk.Choices[0]
		if choice.Delta.Content != "" {
			output.WriteString(choice.Delta.Content)
			if output.Len() > 400000 {
				return "", errors.New("local model response is too large")
			}
			if onText != nil {
				onText(output.String())
			}
		}
		if choice.FinishReason != nil {
			finished = true
			truncated = *choice.FinishReason == "length"
		}
	}
	if ctx.Err() != nil {
		return output.String(), ctx.Err()
	}
	if err := scanner.Err(); err != nil {
		return output.String(), errors.New("could not read the local model response")
	}
	if !finished {
		return output.String(), errors.New("the local model connection ended before the reply finished; retry")
	}
	if truncated {
		return output.String(), errors.New("the reply reached the model's output limit; retry with a request for a shorter answer")
	}
	if err := ValidateText(output.String()); err != nil {
		return "", errors.New("local model returned empty or invalid text")
	}
	return strings.TrimSpace(output.String()), nil
}
