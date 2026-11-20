// Package shortcuts owns native shortcut registrations, capture leases and
// permission-request lifetimes. Its caller serializes state changes and supplies
// native callbacks under the application's operation lock.
package shortcuts

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Registration interface{ Close() }

type Kind uint8

const (
	Recording Kind = iota
	Profile
)

type slot struct {
	registration Registration
	generation   uint64
	retired      chan struct{}
}

type Service struct {
	slots        [2]slot
	captureToken string
	captureTimer *time.Timer
	permission   *Permission
	closed       bool
}

// Attempt identifies callbacks from one native registration. Capture, close and
// replacement all retire it before the native handle is released.
type Attempt struct {
	kind       Kind
	generation uint64
}

func (s *Service) Current(attempt Attempt) bool {
	return !s.closed && s.slots[attempt.kind].generation == attempt.generation
}

func (s *Service) Registration(kind Kind) Registration { return s.slots[kind].registration }
func (s *Service) Capturing() bool                     { return s.captureToken != "" }
func (s *Service) CaptureToken() string                { return s.captureToken }
func (s *Service) Registering() bool                   { return s.permission != nil }

// Register keeps a candidate private across a permission wait and rejects a
// handle whose attempt was retired while the caller released its lock.
func (s *Service) Register(kind Kind, value string, create func(Attempt) (Registration, error)) (*Loss, error) {
	s.Close(kind)
	if s.closed {
		return nil, context.Canceled
	}
	if kind == Profile && value == "" {
		return nil, nil
	}
	attempt := Attempt{kind: kind, generation: s.slots[kind].generation}
	registration, err := create(attempt)
	if !s.Current(attempt) {
		if registration != nil {
			registration.Close()
		}
		return nil, context.Canceled
	}
	if err != nil {
		return nil, err
	}
	s.slots[kind].registration = registration
	observable, ok := registration.(interface {
		Done() <-chan struct{}
		Err() error
	})
	if !ok || observable.Done() == nil {
		return nil, nil
	}
	retired := make(chan struct{})
	s.slots[kind].retired = retired
	return &Loss{attempt: attempt, done: observable.Done(), retired: retired, err: observable.Err}, nil
}

// Ready and RegisterMissing implement retry policy without disturbing a working
// handle or opening a second permission prompt after cancellation.
func (s *Service) Ready(profile string) bool {
	return s.Registration(Recording) != nil && (s.Registration(Profile) != nil || profile == "")
}

func (s *Service) RegisterMissing(recording, profile string, register func(Kind, string) error) {
	if s.Registration(Recording) == nil {
		if err := register(Recording, recording); Cancelled(err) {
			return
		}
	}
	if s.Registration(Profile) == nil {
		_ = register(Profile, profile)
	}
}

func Cancelled(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// Loss waits without accessing mutable service state. Retirement unblocks the
// observer even when a native handle never signals Done after Close.
type Loss struct {
	attempt Attempt
	done    <-chan struct{}
	retired <-chan struct{}
	err     func() error
}

func (l *Loss) Wait() error {
	select {
	case <-l.retired:
		return nil
	case <-l.done:
		return l.err()
	}
}

func (s *Service) Lost(loss *Loss, err error) bool {
	if err == nil || !s.Current(loss.attempt) {
		return false
	}
	s.detach(loss.attempt.kind)
	return true
}

func (l *Loss) Kind() Kind { return l.attempt.kind }

func (s *Service) detach(kind Kind) Registration {
	slot := &s.slots[kind]
	slot.generation++
	if slot.retired != nil {
		close(slot.retired)
		slot.retired = nil
	}
	registration := slot.registration
	slot.registration = nil
	return registration
}

func (s *Service) Close(kind Kind) {
	if registration := s.detach(kind); registration != nil {
		registration.Close()
	}
}

func (s *Service) BeginCapture(lease time.Duration, expired func(string)) string {
	if s.closed {
		return ""
	}
	s.EndCapture(s.captureToken)
	token := uuid.NewString()
	s.captureToken = token
	s.Close(Profile)
	s.Close(Recording)
	s.captureTimer = time.AfterFunc(lease, func() { expired(token) })
	return token
}

// EndCapture consumes only the current lease; stale expiry callbacks are inert.
func (s *Service) EndCapture(token string) bool {
	if token == "" || token != s.captureToken {
		return false
	}
	s.captureToken = ""
	if s.captureTimer != nil {
		s.captureTimer.Stop()
		s.captureTimer = nil
	}
	return true
}

// Permission is reserved before the caller releases its operation lock. It is
// completed under that lock after native registration returns.
type Permission struct {
	ctx    context.Context
	cancel context.CancelFunc
}

func (p *Permission) Context() context.Context { return p.ctx }

func (s *Service) BeginRegistration(parent context.Context) (*Permission, error) {
	if s.closed || s.permission != nil {
		return nil, context.Canceled
	}
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	permission := &Permission{ctx: ctx, cancel: cancel}
	s.permission = permission
	return permission, nil
}

func (s *Service) FinishRegistration(permission *Permission, registration Registration, err error) (Registration, error) {
	current := s.permission == permission
	if current {
		s.permission = nil
	}
	cancelled := permission.ctx.Err()
	permission.cancel()
	if s.closed || !current || cancelled != nil {
		if registration != nil {
			registration.Close()
		}
		return nil, context.Canceled
	}
	return registration, err
}

func (s *Service) CancelRegistration() {
	if s.permission != nil {
		s.permission.cancel()
	}
}

// Shutdown retires all callbacks under the caller's lock and transfers handles
// for closing after that lock is released.
func (s *Service) Shutdown() []Registration {
	s.closed = true
	s.CancelRegistration()
	s.EndCapture(s.captureToken)
	var registrations []Registration
	for _, kind := range []Kind{Recording, Profile} {
		if registration := s.detach(kind); registration != nil {
			registrations = append(registrations, registration)
		}
	}
	return registrations
}
