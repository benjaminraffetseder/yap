package app

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"yap/internal/audio"
	"yap/internal/storage"
)

func audioStreamFixture(t *testing.T, size int64) (*App, string, string) {
	t.Helper()
	a := testApp(t)
	f, path, err := a.store.CreateRecording()
	if err != nil {
		t.Fatal(err)
	}
	if err = audio.Header(f, uint32(size-44)); err == nil {
		err = f.Truncate(size)
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		t.Fatal(err)
	}
	if err = a.store.Add(storage.NewSession("stream", 1000, "Synthetic audio.", "base", "en", path)); err != nil {
		t.Fatal(err)
	}
	url, err := a.GetAudioURL("stream")
	if err != nil {
		t.Fatal(err)
	}
	return a, path, url
}

func TestAudioURLRangesHeadAndRetiredSessions(t *testing.T) {
	a, path, url := audioStreamFixture(t, 64044)
	if !strings.HasPrefix(url, "http://127.0.0.1:") || strings.Contains(url, path) {
		t.Fatal("URL exposed storage path")
	}
	handler := http.HandlerFunc(a.serveAudio)
	for _, tc := range []struct {
		method, target, byteRange string
		status, length            int
	}{
		{"GET", url, "bytes=0-43", 206, 44},
		{"GET", url, "bytes=-16", 206, 16},
		{"HEAD", url, "", 200, 0},
		{"GET", url, "bytes=999999-", 416, -1},
		{"POST", url, "", 405, -1},
		{"GET", audioURLPrefix + "unknown", "", 404, -1},
		{"GET", "/static", "", 404, -1},
	} {
		r := httptest.NewRequest(tc.method, tc.target, nil)
		if tc.byteRange != "" {
			r.Header.Set("Range", tc.byteRange)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status || (tc.length >= 0 && w.Body.Len() != tc.length) {
			t.Fatalf("%s %s: status %d bytes %d", tc.method, tc.byteRange, w.Code, w.Body.Len())
		}
		if tc.method == "HEAD" && w.Header().Get("Content-Length") != "64044" {
			t.Fatal("HEAD lost length")
		}
		if tc.status == 206 && (w.Header().Get("Content-Type") != "audio/wav" || w.Header().Get("Cache-Control") != "no-store") {
			t.Fatal("incorrect media headers")
		}
	}
	if err := a.DeleteSessions([]string{"stream"}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
	if w.Code != http.StatusNotFound {
		t.Fatal("deleted session URL remained available", w.Code)
	}
}

func TestAudioURLsExpireAndRemainBounded(t *testing.T) {
	a, path, target := audioStreamFixture(t, 6444)
	parsed, err := url.Parse(target)
	if err != nil {
		t.Fatal(err)
	}
	token := strings.TrimPrefix(parsed.Path, audioURLPrefix)
	link := a.audioLinks[token]
	expires := link.expires
	// Reissuing a URL and requesting bytes can update recency, never its expiry.
	if same, err := a.GetAudioURL("stream"); err != nil || same != target {
		t.Fatal("active URL was not reused", same, err)
	}
	w := httptest.NewRecorder()
	a.serveAudio(w, httptest.NewRequest("HEAD", target, nil))
	if w.Code != 200 || !a.audioLinks[token].expires.Equal(expires) {
		t.Fatal("playback extended the capability lifetime")
	}
	link.expires = time.Now().Add(-time.Minute)
	a.audioLinks[token] = link
	w = httptest.NewRecorder()
	a.serveAudio(w, httptest.NewRequest("GET", target, nil))
	if w.Code != 404 {
		t.Fatal("expired URL remained valid")
	}
	for index := 0; index < audioLinkLimit+8; index++ {
		id := fmt.Sprintf("stream-%d", index)
		if err := a.store.Add(storage.NewSession(id, 1000, "Synthetic audio.", "base", "en", path)); err != nil {
			t.Fatal(err)
		}
		if _, err := a.GetAudioURL(id); err != nil {
			t.Fatal(err)
		}
	}
	if len(a.audioLinks) != audioLinkLimit {
		t.Fatal("unbounded URL ownership", len(a.audioLinks))
	}
	target, err = a.GetAudioURL("stream")
	if err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	a.closing = true
	a.mu.Unlock()
	w = httptest.NewRecorder()
	a.serveAudio(w, httptest.NewRequest("GET", target, nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatal("shutdown allowed new playback")
	}
}

func TestAudioHTTPStreamsFullAndOpenEndedRequestsAndDrainsOnShutdown(t *testing.T) {
	for _, byteRange := range []string{"", "bytes=0-"} {
		t.Run(byteRange, func(t *testing.T) {
			a, _, target := audioStreamFixture(t, audio.MaxNormalizedImportBytes)
			transport := &http.Transport{Proxy: nil}
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
			request, err := http.NewRequest("GET", target, nil)
			if err != nil {
				t.Fatal(err)
			}
			if byteRange != "" {
				request.Header.Set("Range", byteRange)
			}
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			wantStatus := 200
			if byteRange != "" {
				wantStatus = 206
			}
			if response.StatusCode != wantStatus || response.ContentLength != audio.MaxNormalizedImportBytes {
				t.Fatal("incorrect full response", response.StatusCode, response.ContentLength)
			}
			prefix := make([]byte, 1024)
			if _, err := io.ReadFull(response.Body, prefix); err != nil || string(prefix[:4]) != "RIFF" {
				t.Fatal("first bytes unavailable", err)
			}
			// Leave this maximum-sized response unread. Closing the app must
			// cancel the socket write before it waits for the serving goroutine.
			done := make(chan struct{})
			go func() { a.shutdown(a.ctx); close(done) }()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				response.Body.Close()
				t.Fatal("shutdown waited for an unread audio response")
			}
			response.Body.Close()
			if response, err := client.Get(target); err == nil {
				response.Body.Close()
				t.Fatal("playback listener remained open after shutdown")
			}
		})
	}
}

type streamingAudioWriter struct {
	header  http.Header
	written int
	onWrite func()
}

func (w *streamingAudioWriter) Header() http.Header { return w.header }
func (w *streamingAudioWriter) WriteHeader(int)     {}
func (w *streamingAudioWriter) Write(data []byte) (int, error) {
	if w.onWrite != nil {
		callback := w.onWrite
		w.onWrite = nil
		callback()
	}
	w.written += len(data)
	return len(data), nil
}

func TestAudioStreamReleasesAppMutexAndFreezesReadLength(t *testing.T) {
	const size = 64044
	a, path, url := audioStreamFixture(t, size)
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	w := &streamingAudioWriter{header: make(http.Header), onWrite: func() { close(started); <-release }}
	go func() { defer close(done); a.serveAudio(w, httptest.NewRequest("GET", url, nil)) }()
	defer func() {
		close(release)
		<-done
		if w.written != size {
			t.Errorf("stream grew after headers: %d bytes", w.written)
		}
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("stream never started")
	}
	read := make(chan error, 1)
	go func() { _, err := a.GetRuntimeSnapshot(); read <- err }()
	select {
	case err := <-read:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("stream held application mutex")
	}
	// Appending after headers cannot expand the declared section or read budget.
	f, err := os.OpenFile(path, os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(audio.MaxNormalizedImportBytes + 1); err != nil {
		f.Close()
		t.Fatal(err)
	}
	f.Close()
	// The deferred drain runs after these checks; its Content-Length was fixed
	// before the append and ServeContent reads a section of exactly that size.
	if w.Header().Get("Content-Length") != strconv.Itoa(size) {
		t.Fatal("length changed while streaming")
	}
}

func BenchmarkAudioPlaybackTransfer(b *testing.B) {
	a := newApp(Options{})
	a.ctx = context.Background()
	var err error
	a.store, err = storage.Open(b.TempDir())
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { a.shutdown(a.ctx) })
	f, path, err := a.store.CreateRecording()
	if err != nil {
		b.Fatal(err)
	}
	const size = 8 << 20
	if err = audio.Header(f, size-44); err == nil {
		err = f.Truncate(size)
	}
	f.Close()
	if err != nil {
		b.Fatal(err)
	}
	if err = a.store.Add(storage.NewSession("stream", 1000, "Synthetic audio.", "base", "en", path)); err != nil {
		b.Fatal(err)
	}
	url, err := a.GetAudioURL("stream")
	if err != nil {
		b.Fatal(err)
	}
	b.Run("legacy_full_bridge_payload", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			if _, err := a.GetAudio("stream"); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("first_bytes_http", func(b *testing.B) {
		transport := &http.Transport{Proxy: nil}
		defer transport.CloseIdleConnections()
		client := &http.Client{Transport: transport}
		prefix := make([]byte, 1024)
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			response, err := client.Get(url)
			if err != nil {
				b.Fatal(err)
			}
			_, err = io.ReadFull(response.Body, prefix)
			response.Body.Close()
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}
