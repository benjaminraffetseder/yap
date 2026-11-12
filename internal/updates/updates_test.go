package updates

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

type fakeEngine struct {
	calls   int
	release *updater.Release
	err     error
}

func (e *fakeEngine) Check(context.Context) (*updater.Release, error) {
	e.calls++
	return e.release, e.err
}
func (*fakeEngine) CheckAndInstall(context.Context) error { panic("a check must not install") }
func (*fakeEngine) Restart(context.Context) error         { panic("a check must not restart") }
func (*fakeEngine) State() updater.State                  { return updater.StateIdle }

func TestDailyChecksCacheStatusAndManualChecksRetry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update-check.json")
	e := &fakeEngine{release: &updater.Release{Version: "0.2.0", Notes: "# Fixes\n" + strings.Repeat("漢", 4000)}}
	now := time.Now()
	newChecker := func(current, repo string) *Checker {
		c := New(current, repo, path, e)
		c.now = func() time.Time { return now }
		return c
	}
	c := newChecker("0.1.0", "owner/yap")
	s := c.Check(context.Background(), false)
	if !s.Available || s.Error != "" || s.LatestVersion != "0.2.0" || len(s.Notes) > 8000 || !utf8.ValidString(s.Notes) {
		t.Fatalf("unexpected Wails release: %+v", s)
	}
	c = newChecker("0.1.0", "owner/yap")
	if !c.Check(context.Background(), false).Available || e.calls != 1 {
		t.Fatal("startup cache was not preserved")
	}
	e.err = errors.New("offline")
	s = c.Check(context.Background(), true)
	if !s.Available || s.Error != "offline" || e.calls != 2 {
		t.Fatalf("manual retry lost the known update: %+v", s)
	}
	c = newChecker("0.1.0", "owner/yap")
	c.Check(context.Background(), false)
	if e.calls != 2 {
		t.Fatal("failed attempts were not throttled across restarts")
	}
	now = now.Add(24 * time.Hour)
	e.err, e.release = nil, nil
	s = c.Check(context.Background(), false)
	if s.Available || s.Error != "" || s.Notes != "" || e.calls != 3 {
		t.Fatalf("no-update result retained a stale release: %+v", s)
	}
	if s := newChecker("0.2.0", "owner/yap").Status(); s.Available || s.CheckedAt != "" {
		t.Fatal("cache survived a version change")
	}
	if s := newChecker("0.1.0", "other/yap").Status(); s.CheckedAt != "" {
		t.Fatal("cache survived a repository change")
	}
}

func TestLegacyInstallerCacheCannotBecomeAWailsUpdate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update-check.json")
	data := `{"repository":"owner/yap","lastAttempt":"2099-01-01T00:00:00Z","release":{"version":"99.0.0","downloadURL":"https://example.com/setup.exe"}}`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	e := &fakeEngine{}
	c := New("0.1.0", "owner/yap", path, e)
	if c.Status().Available {
		t.Fatal("offered a cached legacy installer")
	}
	c.Check(context.Background(), false)
	if e.calls != 1 {
		t.Fatal("legacy cache suppressed the first Wails check")
	}
	if s := New("0.1.0", "", path, e).Check(context.Background(), true); s.Configured || e.calls != 1 {
		t.Fatal("unconfigured build contacted a provider")
	}
}

func TestAssetSelectionNeverChoosesInstallersOrSidecars(t *testing.T) {
	assets := []github.ReleaseAsset{
		{Name: "yap-0.2.0-windows-amd64-setup.exe", Size: 1},
		{Name: "yap-0.2.0-windows-amd64.exe.sha256", Size: 1},
		{Name: "Yap-0.2.0-macos-universal.zip", Size: 1},
		{Name: "yap-0.2.0-windows-amd64.exe", Size: 1},
		{Name: "Yap-0.2.0-macos-arm64.zip", Size: 1},
	}
	for _, tc := range []struct {
		platform, arch string
		want           int
	}{
		{"windows", "amd64", 3}, {"windows", "arm64", -1},
		{"darwin", "arm64", 4}, {"darwin", "amd64", 2}, {"linux", "amd64", -1},
	} {
		if got := matchAsset(updater.CheckRequest{Platform: tc.platform, Arch: tc.arch}, assets); got != tc.want {
			t.Errorf("%s/%s selected %d, want %d", tc.platform, tc.arch, got, tc.want)
		}
	}
	assets[3].Size = 0
	if matchAsset(updater.CheckRequest{Platform: "windows", Arch: "amd64"}, assets) != -1 {
		t.Fatal("selected an empty executable")
	}
}

type testHost struct{}

func (testHost) Emit(string, ...any) bool         { return true }
func (testHost) OnEvent(string, func(any)) func() { return func() {} }
func (testHost) OpenWindow(updater.WindowOptions) updater.WindowHandle {
	panic("unexpected native window in headless test")
}
func (testHost) Quit() { panic("staging must not quit the app") }

func TestWailsGitHubDownloadVerificationAndStaging(t *testing.T) {
	const filename = "yap-0.2.0-windows-amd64.exe"
	payload := []byte("test executable bytes; never launched")
	digest := sha256.Sum256(payload)
	for _, mode := range []string{"valid", "missing sidecar", "missing entry", "short digest", "malformed digest", "mismatch", "installer only", "wrong asset version", "already current", "no release"} {
		t.Run(mode, func(t *testing.T) {
			downloads := 0
			var server *httptest.Server
			server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/repos/owner/yap/releases/latest":
					if mode == "no release" {
						w.WriteHeader(http.StatusNotFound)
						return
					}
					name := filename
					if mode == "installer only" {
						name = "yap-0.2.0-windows-amd64-setup.exe"
					}
					if mode == "wrong asset version" {
						name = "yap-0.1.0-windows-amd64.exe"
					}
					assets := []map[string]any{{"name": name, "size": len(payload), "url": server.URL + "/artifact"}}
					if mode != "missing sidecar" {
						assets = append(assets, map[string]any{"name": "SHA256SUMS", "url": server.URL + "/checksums"})
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v0.2.0", "body": "Release notes", "assets": assets})
				case "/checksums":
					line := fmt.Sprintf("%x  %s\n", digest, filename)
					switch mode {
					case "missing entry":
						line = fmt.Sprintf("%x  other.exe\n", digest)
					case "short digest":
						line = "abcd  " + filename
					case "malformed digest":
						line = "not-hex  " + filename
					case "mismatch":
						line = strings.Repeat("0", 64) + "  " + filename
					}
					_, _ = fmt.Fprint(w, line)
				case "/artifact":
					downloads++
					_, _ = w.Write(payload)
				default:
					t.Errorf("unexpected request: %s", r.URL)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			provider, err := newGitHub(github.Config{Repository: "owner/yap", BaseURL: server.URL, HTTPClient: server.Client()})
			if err != nil {
				t.Fatal(err)
			}
			current := "0.1.0"
			if mode == "already current" {
				current = "0.2.0"
			}
			engine := updater.New(testHost{})
			if err := engine.Init(updater.Config{CurrentVersion: current, Providers: []updater.Provider{provider}, Platform: "windows", Arch: "amd64", Window: updater.WindowNone}); err != nil {
				t.Fatal(err)
			}
			release, err := engine.Check(context.Background())
			if mode == "already current" || mode == "no release" {
				if err != nil || release != nil {
					t.Fatalf("unexpected update: %+v, %v", release, err)
				}
				return
			}
			if mode != "valid" && mode != "mismatch" {
				if err == nil || release != nil || downloads != 0 {
					t.Fatalf("incomplete release accepted: %+v, %v", release, err)
				}
				return
			}
			if err != nil || release == nil || release.Version != "0.2.0" || downloads != 0 {
				t.Fatalf("bad check: %+v, %v", release, err)
			}
			err = engine.DownloadAndInstall(context.Background())
			if mode == "mismatch" {
				if err == nil || engine.DownloadedPath() != "" || engine.State() != updater.StateError {
					t.Fatal("checksum mismatch was staged")
				}
				return
			}
			if err != nil || engine.State() != updater.StateReady {
				t.Fatalf("Wails did not stage the update: %v", err)
			}
			staged := engine.DownloadedPath()
			defer os.RemoveAll(filepath.Dir(staged))
			data, err := os.ReadFile(staged)
			if err != nil || string(data) != string(payload) || downloads != 1 {
				t.Fatalf("wrong staged bytes: %v", err)
			}
		})
	}
}
