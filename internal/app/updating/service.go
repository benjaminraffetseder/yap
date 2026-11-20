// Package updating owns updater workflow policy and the native window's lifetime.
// Callers serialize service access and execute prepared operations without their
// application lock. The existing updates package owns release and cache details.
package updating

import (
	"context"
	"errors"
	"runtime"

	"yap/internal/updates"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// Service is initialized lazily from its zero value. It does not start workers
// or synchronize application operations; its caller owns both responsibilities.
type Service struct {
	checker *updates.Checker
	ctx     context.Context
	cancel  context.CancelFunc
	running bool
}

// Policy carries current build configuration because development mode and
// release metadata remain application construction concerns.
type Policy struct {
	Repository  string
	Development bool
}

func (s *Service) Initialized() bool { return s.checker != nil }

// Initialize accepts the existing checker so platform-specific dependencies can
// be constructed without coupling the feature to the desktop application.
func (s *Service) Initialize(ctx context.Context, checker *updates.Checker) {
	if s.Initialized() {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.checker = checker
	s.ctx, s.cancel = context.WithCancel(ctx)
}

// Cancel ends the lifetime shared by checking, staging, native-window retries,
// and Restart & Apply. Finishing an operation deliberately does not cancel it.
func (s *Service) Cancel() {
	if s.cancel != nil {
		s.cancel()
	}
}

func Supported() bool { return updates.Supported(runtime.GOOS, runtime.GOARCH) }

// Configure preserves Wails ownership of the provider and native update window.
func Configure(engine *updater.Updater, version, repository string) error {
	if repository == "" || !Supported() {
		return nil
	}
	provider, err := updates.NewGitHub(repository)
	if err != nil {
		return err
	}
	return engine.Init(updater.Config{
		CurrentVersion: version,
		Providers:      []updater.Provider{provider},
		Window: &updater.BuiltinWindow{Options: updater.WindowOptions{
			Title: "Yap Update",
		}},
	})
}

// PrepareStatus captures the checker under the caller's lock. Reading its
// snapshot runs unlocked because a network check may hold the checker's lock.
func (s *Service) PrepareStatus() func() updates.Status {
	checker := s.checker
	return func() updates.Status {
		status := checker.Status()
		status.Supported = Supported()
		if !status.Supported {
			status.Available, status.Notes = false, ""
		}
		return status
	}
}

// BeginCheck returns nil when an automatic development check or unsupported
// platform should use the existing status. Accepted operations need Finish.
func (s *Service) BeginCheck(manual bool, development bool) (func() updates.Status, error) {
	// Development builds never make automatic network requests.
	if !Supported() || (!manual && development) {
		return nil, nil
	}
	if s.running || s.checker.Busy() {
		return nil, errors.New("an update is already in progress; use the Yap Update window")
	}
	s.running = true
	checker, ctx := s.checker, s.ctx
	return func() updates.Status { return checker.Check(ctx, manual) }, nil
}

func (s *Service) BeginInstall(policy Policy, open func(context.Context, string) error) (func() error, error) {
	if !Supported() || policy.Repository == "" || policy.Development {
		return nil, errors.New("install updates from a packaged Windows, macOS or Linux build")
	}
	if s.running || s.checker.Busy() {
		return nil, errors.New("an update is already in progress; use the Yap Update window")
	}
	s.running = true
	checker, ctx := s.checker, s.ctx
	return func() error {
		if checker.Status().ManualInstall {
			return openPackageUpdate(ctx, checker, open)
		}
		return checker.Install(ctx)
	}, nil
}

func openPackageUpdate(ctx context.Context, checker *updates.Checker, open func(context.Context, string) error) error {
	// Recheck through the Wails provider; cached display metadata is never an
	// installation target. The system package manager owns Debian upgrades.
	status := checker.Check(ctx, true)
	if !status.ManualInstall || !status.Available || status.Error != "" || status.DownloadURL == "" {
		return errors.New("no Debian update download is available; check for updates and retry")
	}
	return open(ctx, status.DownloadURL)
}

// PrepareRestart permits applying an already staged update after closing the
// native window. Wails still owns the helper and normal quit flow.
func (s *Service) PrepareRestart(policy Policy) (func() error, error) {
	if !Supported() || s.checker.Status().ManualInstall || policy.Repository == "" || policy.Development || s.running {
		return nil, errors.New("an update is not ready to restart")
	}
	checker, ctx := s.checker, s.ctx
	return func() error { return checker.Restart(ctx) }, nil
}

func (s *Service) Finish() { s.running = false }
