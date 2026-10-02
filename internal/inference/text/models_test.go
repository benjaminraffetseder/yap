package text

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDiscoveryContractAndLoopbackTransport(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/v1/models" || r.ContentLength != 0 || r.Header.Get("Accept") != "application/json" {
			t.Errorf("unexpected metadata request: %s %s", r.Method, r.URL)
		}
		w.Write([]byte(`{"object":"list","data":[{"id":"z-model"},{"id":"a-model"},{"id":"z-model"}]}`))
	}))
	defer s.Close()
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	models, err := ListModels(context.Background(), s.URL+"/v1/")
	if err != nil || strings.Join(models, ",") != "a-model,z-model" {
		t.Fatalf("bad model list: %v %v", models, err)
	}
	if _, err = ListModels(context.Background(), "https://example.com/v1"); err == nil {
		t.Fatal("allowed a remote endpoint")
	}
}

func TestDiscoveryResponsesAndNoRedirects(t *testing.T) {
	redirected := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected = true }))
	defer target.Close()
	for _, tc := range []struct {
		name, body string
		status     int
		valid      bool
	}{
		{"empty", `{"data":[]}`, 200, true},
		{"missing", `{}`, 200, false},
		{"null", `{"data":null}`, 200, false},
		{"malformed", `bad`, 200, false},
		{"empty ID", `{"data":[{}]}`, 200, false},
		{"unsafe ID", `{"data":[{"id":"bad\nname"}]}`, 200, false},
		{"oversized ID", `{"data":[{"id":"` + strings.Repeat("x", 201) + `"}]}`, 200, false},
		{"too many", `{"data":[` + strings.Repeat(`{"id":"model"},`, 256) + `{"id":"last"}]}`, 200, false},
		{"too large", strings.Repeat("x", 1024*1024+1), 200, false},
		{"unsupported", "sensitive server body", 404, false},
		{"auth", "sensitive server body", 401, false},
		{"server error", "sensitive server body", 500, false},
		{"redirect", "", 307, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", target.URL)
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer s.Close()
			models, err := ListModels(context.Background(), s.URL+"/v1")
			if tc.valid {
				if err != nil || models == nil || len(models) != 0 {
					t.Fatalf("empty list failed: %v %v", models, err)
				}
			} else if err == nil || strings.Contains(err.Error(), "sensitive server body") {
				t.Fatalf("unsafe response accepted: %v", err)
			}
		})
	}
	if redirected {
		t.Fatal("discovery followed a redirect")
	}
}

func TestDiscoveryCancellationAndTimeout(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "deadline"}[deadline], func(t *testing.T) {
			started := make(chan struct{})
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(started)
				<-r.Context().Done()
			}))
			defer s.Close()
			ctx, cancel := context.WithCancel(context.Background())
			if deadline {
				cancel()
				ctx, cancel = context.WithTimeout(context.Background(), 500*time.Millisecond)
			}
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := ListModels(ctx, s.URL+"/v1"); done <- err }()
			select {
			case <-started:
			case err := <-done:
				t.Fatalf("request failed before reaching server: %v", err)
			}
			if !deadline {
				cancel()
			}
			select {
			case err := <-done:
				want := context.Canceled
				if deadline {
					want = context.DeadlineExceeded
				}
				if !errors.Is(err, want) {
					t.Fatalf("incorrect cancellation: %v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("discovery did not stop")
			}
		})
	}
}
