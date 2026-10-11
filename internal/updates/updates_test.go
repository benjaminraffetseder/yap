package updates

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestStableVersions(t *testing.T) {
	for _, tc := range []struct {
		latest, current string
		want            bool
	}{
		{"0.10.0", "0.9.0", true}, {"1.0.0", "0.99.99", true},
		{"0.1.1", "0.1.0", true}, {"0.1.0", "0.1.0", false},
		{"0.1.0", "0.2.0", false}, {"1.0.0", "1.0.1", false},
	} {
		got, err := newer(tc.latest, tc.current)
		if err != nil || got != tc.want {
			t.Fatalf("%s > %s: %v, %v", tc.latest, tc.current, got, err)
		}
	}
	for _, invalid := range []string{"", "1.0", "v1.0.0", "1.0.0-beta", "01.0.0", "1.+1.0", "1.0.0.0", "18446744073709551616.0.0"} {
		if _, err := newer(invalid, "0.1.0"); err == nil {
			t.Errorf("accepted %q", invalid)
		}
	}
}

func newTestChecker(t *testing.T, handler http.HandlerFunc) (*Checker, *httptest.Server) {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	c := New("0.1.0", "owner/yap", filepath.Join(t.TempDir(), "update-check.json"))
	c.feed = server.URL + "/repos/owner/yap/releases/latest"
	c.client.Transport = server.Client().Transport
	return c, server
}

func TestCheckCachesAcrossRestartsAndManualBypassesDailyLimit(t *testing.T) {
	calls := 0
	c, server := newTestChecker(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" || r.URL.String() != "/repos/owner/yap/releases/latest" || r.ContentLength > 0 {
			t.Errorf("unexpected request: %s %s (%d)", r.Method, r.URL, r.ContentLength)
		}
		if r.Header.Get("Accept") != "application/vnd.github+json" || r.Header.Get("X-GitHub-Api-Version") == "" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected API headers: %v", r.Header)
		}
		ioJSON(w, githubJSON("v0.2.0", "A useful fix."))
	})
	now := time.Now()
	c.now = func() time.Time { return now }
	s := c.Check(context.Background(), false)
	if !s.Available || s.DownloadURL != "https://github.com/owner/yap/releases/download/v0.2.0/yap-0.2.0-windows-amd64-setup.exe" || s.Notes != "A useful fix." || s.Error != "" {
		t.Fatalf("unexpected release: %+v", s)
	}
	c.Check(context.Background(), false)
	restarted := New("0.1.0", c.repository, c.path)
	restarted.feed = server.URL + "/repos/owner/yap/releases/latest"
	restarted.client.Transport = c.client.Transport
	restarted.now = c.now
	if !restarted.Check(context.Background(), false).Available || calls != 1 {
		t.Fatalf("cache failed after restart, calls=%d", calls)
	}
	restarted.Check(context.Background(), true)
	if calls != 2 {
		t.Fatal("manual check was throttled")
	}
	now = now.Add(24 * time.Hour)
	restarted.Check(context.Background(), false)
	if calls != 3 {
		t.Fatal("next day's startup did not check")
	}
	upgraded := New("0.2.0", c.repository, c.path).Status()
	if upgraded.Available || upgraded.DownloadURL != "" {
		t.Fatalf("offered installed version: %+v", upgraded)
	}
}

func ioJSON(w http.ResponseWriter, data string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(data))
}

func githubJSON(tag, notes string) string {
	version := strings.TrimPrefix(tag, "v")
	filename := "yap-" + version + "-windows-amd64-setup.exe"
	data, _ := json.Marshal(map[string]any{
		"tag_name": tag, "body": notes, "draft": false, "prerelease": false,
		"assets": []map[string]any{{"name": filename, "state": "uploaded", "size": 123,
			"browser_download_url": "https://github.com/owner/yap/releases/download/" + tag + "/" + filename}},
	})
	return string(data)
}

func TestLongGitHubReleaseNotesAreBoundedPlainText(t *testing.T) {
	c, _ := newTestChecker(t, func(w http.ResponseWriter, r *http.Request) {
		ioJSON(w, githubJSON("0.2.0", "# Fixes\n"+strings.Repeat("漢", 4000)))
	})
	if s := c.Check(context.Background(), false); !s.Available || s.Error != "" || len(s.Notes) > 8000 || !utf8.ValidString(s.Notes) || !strings.HasPrefix(s.Notes, "# Fixes\n") {
		t.Fatalf("unexpected notes preview: %+v", s)
	}
}

func TestRejectInvalidMetadataAndPreserveKnownUpdate(t *testing.T) {
	valid := githubJSON("v0.2.0", "Notes")
	for _, invalid := range []string{
		`<html>Not a manifest</html>`,
		strings.ReplaceAll(valid, "https://github.com/owner/yap/", "https://evil.example/"),
		strings.ReplaceAll(valid, "/owner/yap/", "/owner/other/"),
		strings.ReplaceAll(valid, "/download/v0.2.0/", "/download/v0.1.0/"),
		strings.ReplaceAll(valid, "windows-amd64", "windows-arm64"),
		githubJSON("v0.2.0-beta", "Beta"),
		strings.Replace(valid, `"draft":false`, `"draft":true`, 1),
		strings.Replace(valid, `"prerelease":false`, `"prerelease":true`, 1),
		strings.Replace(valid, `"state":"uploaded"`, `"state":"starter"`, 1),
		strings.Replace(valid, `"size":123`, `"size":0`, 1),
		`{"tag_name":"v0.2.0","assets":[]}`,
		valid + ` {}`,
		strings.Repeat(" ", maxMetadata+1),
	} {
		t.Run(invalid[:min(len(invalid), 60)], func(t *testing.T) {
			body := valid
			c, _ := newTestChecker(t, func(w http.ResponseWriter, r *http.Request) { ioJSON(w, body) })
			c.Check(context.Background(), true)
			body = invalid
			s := c.Check(context.Background(), true)
			if s.Error == "" || !s.Available || s.LatestVersion != "0.2.0" {
				t.Fatalf("invalid manifest replaced known update: %+v", s)
			}
		})
	}
}

func TestFailedAttemptsAreThrottledAndManualCanRecover(t *testing.T) {
	calls, fail := 0, true
	c, _ := newTestChecker(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if fail {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		ioJSON(w, githubJSON("v0.1.0", ""))
	})
	if s := c.Check(context.Background(), false); s.Error == "" || s.CheckedAt != "" {
		t.Fatalf("failure appeared successful: %+v", s)
	}
	transport := c.client.Transport
	feed := c.feed
	c = New(c.current, c.repository, c.path)
	c.feed = feed
	c.client.Transport = transport
	c.Check(context.Background(), false)
	if calls != 1 {
		t.Fatal("failed attempt wasn't cached")
	}
	fail = false
	s := c.Check(context.Background(), true)
	if s.Error != "" || s.CheckedAt == "" || s.Available || calls != 2 {
		t.Fatalf("manual check did not recover: %+v", s)
	}
}

func TestCancellationDoesNotWaitForNetworkTimeout(t *testing.T) {
	started := make(chan struct{})
	c, _ := newTestChecker(t, func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan Status, 1)
	go func() { done <- c.Check(ctx, true) }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("request never started")
	}
	cancel()
	select {
	case s := <-done:
		if s.Error == "" || s.CheckedAt != "" {
			t.Fatalf("cancellation appeared successful: %+v", s)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled check waited for timeout")
	}
}

func TestRepositoryAndCacheCannotSupplyUntrustedDownload(t *testing.T) {
	for _, repository := range []string{"https://example.com", "owner/../other", "owner/repo?token=secret", "owner/", "../repo"} {
		c := New("0.1.0", repository, filepath.Join(t.TempDir(), "cache.json"))
		if s := c.Check(context.Background(), true); s.Available || s.Error == "" {
			t.Fatalf("accepted repository %q: %+v", repository, s)
		}
	}
	c, _ := newTestChecker(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://example.com/release.json", http.StatusFound)
	})
	if s := c.Check(context.Background(), true); s.Available || s.Error == "" {
		t.Fatalf("accepted insecure redirect: %+v", s)
	}
	data, _ := json.Marshal(cache{Repository: c.repository, Release: manifest{Version: "0.2.0", Tag: "v0.2.0", Installer: "yap-0.2.0-windows-amd64-setup.exe", DownloadURL: "https://evil.example/setup.exe"}})
	if err := os.WriteFile(c.path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if s := New(c.current, c.repository, c.path).Status(); s.Available || s.DownloadURL != "" {
		t.Fatalf("accepted poisoned cache: %+v", s)
	}
}

func TestNoPublicReleaseIsNotReportedAsUpToDateOrOffline(t *testing.T) {
	c, _ := newTestChecker(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotFound) })
	s := c.Check(context.Background(), false)
	if s.Error != "" || s.Message != "No public GitHub release is available yet." || s.Available || s.LatestVersion != "" || s.CheckedAt == "" {
		t.Fatalf("unexpected no-release status: %+v", s)
	}
	if saved := New(c.current, c.repository, c.path).Status(); saved.Message != s.Message {
		t.Fatalf("lost no-release status across restart: %+v", saved)
	}
}

func TestRateLimitsPreserveKnownRelease(t *testing.T) {
	for _, code := range []int{http.StatusForbidden, http.StatusTooManyRequests} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			limited := false
			c, _ := newTestChecker(t, func(w http.ResponseWriter, r *http.Request) {
				if limited {
					w.Header().Set("X-RateLimit-Remaining", "0")
					w.WriteHeader(code)
					return
				}
				ioJSON(w, githubJSON("v0.2.0", ""))
			})
			c.Check(context.Background(), true)
			limited = true
			if s := c.Check(context.Background(), true); !s.Available || !strings.Contains(s.Error, "GitHub temporarily limited") {
				t.Fatalf("unexpected rate limit status: %+v", s)
			}
		})
	}
}

func TestOldWebsiteCacheAndOtherRepositoryCacheAreIgnored(t *testing.T) {
	for _, saved := range []string{
		`{"feed":"https://example.com/release.json","lastAttempt":"2099-01-01T00:00:00Z","release":{"version":"0.2.0","installer":"yap-0.2.0-windows-amd64-setup.exe"}}`,
		`{"repository":"owner/other","lastAttempt":"2099-01-01T00:00:00Z"}`,
	} {
		path := filepath.Join(t.TempDir(), "cache.json")
		if err := os.WriteFile(path, []byte(saved), 0600); err != nil {
			t.Fatal(err)
		}
		c := New("0.1.0", "owner/yap", path)
		if s := c.Status(); s.Available || s.CheckedAt != "" || !c.cached.LastAttempt.IsZero() {
			t.Fatalf("loaded incompatible cache: %+v", s)
		}
	}
}
