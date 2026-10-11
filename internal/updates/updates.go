// Package updates checks release metadata. It never downloads or executes software.
package updates

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"yap/internal/fileutil"
)

const maxMetadata = 1 << 20

var (
	errNoRelease   = errors.New("no public GitHub release")
	errRateLimited = errors.New("GitHub API rate limit")
	errNoInstaller = errors.New("no Windows installer asset")
)

type Status struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	Available      bool   `json:"available"`
	Supported      bool   `json:"supported"`
	Configured     bool   `json:"configured"`
	CheckedAt      string `json:"checkedAt"`
	DownloadURL    string `json:"downloadURL"`
	Notes          string `json:"notes"`
	Error          string `json:"error"`
	Message        string `json:"message"`
}

type manifest struct {
	Version     string `json:"version"`
	Tag         string `json:"tag"`
	Installer   string `json:"installer"`
	DownloadURL string `json:"downloadURL"`
	Notes       string `json:"notes,omitempty"`
}

type cache struct {
	Repository  string    `json:"repository"`
	LastAttempt time.Time `json:"lastAttempt"`
	LastSuccess time.Time `json:"lastSuccess"`
	Release     manifest  `json:"release"`
	Error       string    `json:"error,omitempty"`
}

type Checker struct {
	mu         sync.Mutex
	current    string
	repository string
	feed       string
	path       string
	client     *http.Client
	now        func() time.Time
	cached     cache
}

func New(current, repository, cachePath string) *Checker {
	c := &Checker{current: current, repository: repository, path: cachePath, now: time.Now}
	if repository != "" {
		c.feed = "https://api.github.com/repos/" + repository + "/releases/latest"
	}
	c.client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "https" || req.URL.Host != via[0].URL.Host || req.URL.User != nil {
			return errors.New("release metadata redirected outside its HTTPS host")
		}
		return nil
	}}
	if f, err := os.Open(cachePath); err == nil {
		defer f.Close()
		data, err := readMetadata(f)
		var saved cache
		if err == nil && json.Unmarshal(data, &saved) == nil && saved.Repository == repository && repository != "" {
			// Validate cached metadata exactly as we validate the network response.
			if saved.Release.Version == "" || c.validate(saved.Release) == nil {
				c.cached = saved
			}
		}
	}
	return c
}

func (c *Checker) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status()
}

func (c *Checker) status() Status {
	s := Status{CurrentVersion: c.current, Supported: true, Configured: c.repository != "", Error: c.cached.Error}
	if !c.cached.LastSuccess.IsZero() {
		s.CheckedAt = c.cached.LastSuccess.UTC().Format(time.RFC3339)
		if c.cached.Release.Version == "" {
			s.Message = "No public GitHub release is available yet."
		}
	}
	if c.cached.Release.Version != "" && c.validate(c.cached.Release) == nil {
		s.LatestVersion = c.cached.Release.Version
		s.Available, _ = newer(s.LatestVersion, c.current)
		if s.Available {
			s.DownloadURL = c.cached.Release.DownloadURL
			s.Notes = c.cached.Release.Notes
		}
	}
	return s
}

// Check limits automatic attempts to once per day, including after a failure.
// Manual checks bypass that limit. Network requests do not touch dictation state.
func (c *Checker) Check(ctx context.Context, manual bool) Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.repository == "" {
		return c.status()
	}
	now := c.now()
	age := now.Sub(c.cached.LastAttempt)
	if !manual && !c.cached.LastAttempt.IsZero() && age >= 0 && age < 24*time.Hour {
		return c.status()
	}
	c.cached.Repository, c.cached.LastAttempt = c.repository, now
	release, err := c.fetch(ctx)
	if errors.Is(err, errNoRelease) {
		c.cached.Release, c.cached.LastSuccess, c.cached.Error = manifest{}, now, ""
	} else if err != nil {
		c.cached.Error = "Couldn’t check for updates. Check your internet connection and try again."
		if errors.Is(err, errRateLimited) {
			c.cached.Error = "GitHub temporarily limited update checks. Try again later."
		} else if errors.Is(err, errNoInstaller) {
			c.cached.Error = "The latest GitHub release doesn’t include a Windows x64 installer yet."
		}
	} else {
		c.cached.Release, c.cached.LastSuccess, c.cached.Error = release, now, ""
	}
	data, _ := json.Marshal(c.cached)
	if err := fileutil.WriteAtomic(c.path, data); err != nil && c.cached.Error == "" {
		c.cached.Error = "Update checked, but Yap couldn’t save the result."
	}
	return c.status()
}

func (c *Checker) fetch(ctx context.Context) (manifest, error) {
	if !validRepository(c.repository) {
		return manifest{}, errors.New("invalid GitHub release repository")
	}
	feed, err := url.Parse(c.feed)
	if err != nil || feed.Scheme != "https" || feed.Host == "" || feed.User != nil || feed.RawQuery != "" || feed.Fragment != "" {
		return manifest{}, errors.New("update feed must be a public HTTPS URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.feed, nil)
	if err != nil {
		return manifest{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	req.Header.Set("User-Agent", "Yap-update-checker")
	res, err := c.client.Do(req)
	if err != nil {
		return manifest{}, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return manifest{}, errNoRelease
	}
	if res.StatusCode == http.StatusTooManyRequests || (res.StatusCode == http.StatusForbidden && (res.Header.Get("X-RateLimit-Remaining") == "0" || res.Header.Get("Retry-After") != "")) {
		return manifest{}, errRateLimited
	}
	if res.StatusCode != http.StatusOK {
		return manifest{}, fmt.Errorf("release metadata returned HTTP %d", res.StatusCode)
	}
	data, err := readMetadata(res.Body)
	if err != nil {
		return manifest{}, err
	}
	var github struct {
		Tag        string `json:"tag_name"`
		Body       string `json:"body"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name  string `json:"name"`
			URL   string `json:"browser_download_url"`
			State string `json:"state"`
			Size  int64  `json:"size"`
		} `json:"assets"`
	}
	if err = json.Unmarshal(data, &github); err != nil {
		return manifest{}, err
	}
	if github.Draft || github.Prerelease {
		return manifest{}, errors.New("update must be a published stable release")
	}
	release := manifest{Version: strings.TrimPrefix(github.Tag, "v"), Tag: github.Tag, Notes: github.Body}
	if _, err := newer(release.Version, c.current); err != nil {
		return manifest{}, err
	}
	// Release notes are displayed as plain text, with a bounded preview.
	if len(release.Notes) > 8000 {
		release.Notes = strings.ToValidUTF8(release.Notes[:7996], "") + "\n…"
	}
	expected := "yap-" + release.Version + "-windows-amd64-setup.exe"
	for _, asset := range github.Assets {
		if asset.Name != expected {
			continue
		}
		if release.Installer != "" || asset.State != "uploaded" || asset.Size <= 0 {
			return manifest{}, errors.New("installer asset is incomplete or ambiguous")
		}
		release.Installer, release.DownloadURL = asset.Name, asset.URL
	}
	if release.Installer == "" {
		return manifest{}, errNoInstaller
	}
	return release, c.validate(release)
}

func validRepository(repository string) bool {
	parts := strings.Split(repository, "/")
	if len(parts) != 2 {
		return false
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return false
		}
		for _, ch := range part {
			if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.') {
				return false
			}
		}
	}
	return true
}

func readMetadata(r io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxMetadata+1))
	if len(data) > maxMetadata {
		return nil, errors.New("release metadata is too large")
	}
	return bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}), err
}

func (c *Checker) validate(release manifest) error {
	if _, err := newer(release.Version, c.current); err != nil {
		return err
	}
	if release.Installer != "yap-"+release.Version+"-windows-amd64-setup.exe" {
		return errors.New("unexpected installer filename")
	}
	if len(release.Notes) > 8000 {
		return errors.New("release notes are too long")
	}
	if !validRepository(c.repository) || (release.Tag != release.Version && release.Tag != "v"+release.Version) {
		return errors.New("invalid release repository or tag")
	}
	expectedURL := "https://github.com/" + c.repository + "/releases/download/" + release.Tag + "/" + release.Installer
	if release.DownloadURL != expectedURL {
		return errors.New("installer URL does not match the GitHub repository, tag, and filename")
	}
	return nil
}

// Stable releases use the same three numeric components as wails.json and NSIS.
func newer(latest, current string) (bool, error) {
	parse := func(s string) ([3]uint64, error) {
		var result [3]uint64
		parts := strings.Split(s, ".")
		if len(parts) != 3 {
			return result, errors.New("version must have three numeric components")
		}
		for i, p := range parts {
			if p == "" || (len(p) > 1 && p[0] == '0') {
				return result, errors.New("invalid version component")
			}
			for _, ch := range p {
				if ch < '0' || ch > '9' {
					return result, errors.New("invalid version component")
				}
			}
			var err error
			result[i], err = strconv.ParseUint(p, 10, 64)
			if err != nil {
				return result, err
			}
		}
		return result, nil
	}
	a, err := parse(latest)
	if err != nil {
		return false, err
	}
	b, err := parse(current)
	if err != nil {
		return false, err
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i], nil
		}
	}
	return false, nil
}
