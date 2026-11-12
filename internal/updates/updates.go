// Package updates adapts the Wails updater to Yap's quiet startup checks.
// Wails owns release discovery, version comparison, downloads, verification,
// staging, the update window, and restart.
package updates

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"

	"yap/internal/fileutil"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

type Status struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	Available      bool   `json:"available"`
	Ready          bool   `json:"ready"`
	Supported      bool   `json:"supported"`
	Configured     bool   `json:"configured"`
	CheckedAt      string `json:"checkedAt"`
	Notes          string `json:"notes"`
	Error          string `json:"error"`
	Message        string `json:"message"`
}

// Engine is implemented by application.App.Updater.
type Engine interface {
	Check(context.Context) (*updater.Release, error)
	CheckAndInstall(context.Context) error
	Restart(context.Context) error
	State() updater.State
}

// Cached status is for display only. It is never reused as a Wails release or
// installation target. CurrentVersion also distinguishes the legacy cache.
type cache struct {
	Repository     string    `json:"repository"`
	CurrentVersion string    `json:"currentVersion"`
	LastAttempt    time.Time `json:"lastAttempt"`
	Status         Status    `json:"status"`
}

type Checker struct {
	mu     sync.Mutex
	engine Engine
	path   string
	now    func() time.Time
	cached cache
	status Status
}

func New(current, repository, cachePath string, engine Engine) *Checker {
	c := &Checker{
		engine: engine, path: cachePath, now: time.Now,
		cached: cache{Repository: repository, CurrentVersion: current},
		status: Status{CurrentVersion: current, Supported: true, Configured: repository != ""},
	}
	if data, err := os.ReadFile(cachePath); err == nil {
		var saved cache
		if json.Unmarshal(data, &saved) == nil && saved.Repository == repository && saved.CurrentVersion == current {
			c.cached.LastAttempt = saved.LastAttempt
			c.status.LatestVersion, c.status.Notes = saved.Status.LatestVersion, saved.Status.Notes
			c.status.Available, c.status.CheckedAt = saved.Status.Available, saved.Status.CheckedAt
			c.status.Error = saved.Status.Error
		}
	}
	return c
}

func (c *Checker) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.status
	s.Ready = c.engine.State() == updater.StateReady
	if s.Ready {
		s.Available, s.Error = true, ""
	}
	return s
}

// Check limits automatic attempts to once per day, including failures. Manual
// checks bypass that limit. It never downloads software or changes dictation.
func (c *Checker) Check(ctx context.Context, manual bool) Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.status.Configured {
		return c.status
	}
	now := c.now()
	age := now.Sub(c.cached.LastAttempt)
	if !manual && !c.cached.LastAttempt.IsZero() && age >= 0 && age < 24*time.Hour {
		return c.status
	}
	c.cached.LastAttempt = now
	release, err := c.engine.Check(ctx)
	if err != nil {
		c.status.Error = err.Error()
	} else {
		c.status.Error = ""
		c.status.CheckedAt = now.UTC().Format(time.RFC3339)
		c.status.Available = release != nil
		c.status.LatestVersion, c.status.Notes = "", ""
		if release != nil {
			c.status.LatestVersion = release.Version
			c.status.Notes = release.Notes
			if len(c.status.Notes) > 8000 {
				c.status.Notes = strings.ToValidUTF8(c.status.Notes[:7996], "") + "\n…"
			}
		}
	}
	c.cached.Status = c.status
	data, _ := json.Marshal(c.cached)
	if err := fileutil.WriteAtomic(c.path, data); err != nil && c.status.Error == "" {
		c.status.Error = "Update checked, but Yap couldn't save the result."
	}
	return c.status
}

// Install deliberately rechecks the provider rather than using cached metadata.
// The Wails window owns progress, errors, retries, and Restart & Apply.
func (c *Checker) Install(ctx context.Context) error {
	err := c.engine.CheckAndInstall(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		c.status.Error = err.Error()
	} else {
		c.status.Error = ""
		c.status.CheckedAt = c.now().UTC().Format(time.RFC3339)
		if c.engine.State() == updater.StateUpToDate {
			c.status.Available = false
			c.status.LatestVersion, c.status.Notes = "", ""
		}
	}
	return err
}

func (c *Checker) Restart(ctx context.Context) error {
	return c.engine.Restart(ctx)
}

func (c *Checker) Busy() bool {
	switch c.engine.State() {
	case updater.StateChecking, updater.StateDownloading, updater.StateVerifying, updater.StateInstalling, updater.StateReady:
		return true
	}
	return false
}
