package text

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatStreamsCompatibleServerAndRejectsIncompleteReplies(t *testing.T) {
	for _, mode := range []string{"stream", "json", "incomplete", "truncated", "context", "remote"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/chat/completions" {
					t.Error(r.URL.Path)
				}
				var body struct {
					Messages []Message
					Stream   bool
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if len(body.Messages) != 3 || !body.Stream {
					t.Error("conversation/stream missing", body)
				}
				if mode == "context" {
					w.WriteHeader(400)
					fmt.Fprint(w, `{"error":{"message":"context window exceeded with PRIVATE TEXT"}}`)
					return
				}
				if mode == "json" {
					fmt.Fprint(w, `{"choices":[{"message":{"content":"Hello world"},"finish_reason":"stop"}]}`)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n\n")
				if mode == "incomplete" {
					return
				}
				reason := "stop"
				if mode == "truncated" {
					reason = "length"
				}
				fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":%q}]}\n\ndata: [DONE]\n\n", reason)
			}))
			defer server.Close()
			endpoint := server.URL + "/v1"
			if mode == "remote" {
				endpoint = "https://example.com/v1"
			}
			var updates []string
			out, err := (Local{}).Chat(context.Background(), Config{Enabled: true, Model: "local", Endpoint: endpoint}, []Message{{"system", "Help"}, {"user", "Hi"}, {"assistant", "Hello"}}, func(text string) { updates = append(updates, text) })
			if mode == "stream" || mode == "json" {
				if err != nil || out != "Hello world" || len(updates) == 0 || updates[len(updates)-1] != out {
					t.Fatal(out, err, updates)
				}
			} else if err == nil || strings.Contains(err.Error(), "PRIVATE") {
				t.Fatal("incomplete/remote/error body accepted", out, err)
			}
		})
	}
}
