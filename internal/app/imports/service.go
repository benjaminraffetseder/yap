// Package imports owns audio import preparation and queue state. Its Service is
// synchronized by the application's operation lock; it starts no workers.
package imports

import (
	"context"
	"errors"
	"math"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"yap/internal/audio"
)

// ImportJob is the public queue view. Source paths stay on the backend.
type ImportJob struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	State      string  `json:"state"`
	Message    string  `json:"message"`
	SessionID  string  `json:"sessionId"`
	Transcript string  `json:"transcript"`
	Error      string  `json:"error"`
	Progress   float64 `json:"progress"`
}

type Installer func(context.Context, string, func(int64, int64)) (string, error)
type Resolver func(context.Context, string, string) (string, error)

type Support struct {
	Resolve   Resolver
	Install   Installer
	Supported bool
}

type job struct {
	ImportJob
	source, decoder string
	resolve         Resolver
	installer       Installer
	lastProgress    time.Time
}

// Batch is an unpublished set of imports. Resolve it outside the application
// lock, obtain any required native confirmation, then enqueue after rechecking
// application availability.
type Batch struct {
	jobs         []*job
	needsInstall bool
	installer    Installer
}

func Prepare(ctx context.Context, paths []string, managedDecoder string, support Support) (Batch, error) {
	if len(paths) == 0 {
		return Batch{}, errors.New("choose at least one audio file")
	}
	batch := Batch{jobs: make([]*job, 0, len(paths)), installer: support.Install}
	for _, source := range paths {
		entry := &job{ImportJob: ImportJob{ID: uuid.NewString(), Name: filepath.Base(source), State: "queued", Message: "Queued", Progress: -1}, source: source, resolve: support.Resolve}
		var err error
		if strings.TrimSpace(source) == "" {
			err = errors.New("choose an audio file")
		} else {
			entry.decoder, err = support.Resolve(ctx, source, managedDecoder)
		}
		if errors.Is(err, audio.ErrFFmpegMissing) && support.Supported {
			batch.needsInstall, err = true, nil
			// Every dependent job retains the batch's approval for explicit retries.
			entry.installer = support.Install
		}
		if err != nil {
			entry.State, entry.Message, entry.Error = "failed", redactError(source, err), redactError(source, err)
		}
		batch.jobs = append(batch.jobs, entry)
	}
	return batch, nil
}

func (b Batch) NeedsInstall() bool { return b.needsInstall }

type Service struct {
	queue           []*job
	active          string
	pending         bool
	installApproved bool
	installer       Installer
}

func (s *Service) ActiveID() string      { return s.active }
func (s *Service) Pending() bool         { return s.pending }
func (s *Service) InstallApproved() bool { return s.installApproved }
func (s *Service) ResetPending()         { s.pending = false }

func (s *Service) Enqueue(batch Batch) {
	if batch.needsInstall && !s.installApproved {
		s.installApproved, s.installer = true, batch.installer
	}
	s.queue = append(s.queue, batch.jobs...)
}

func (s *Service) Snapshot() []ImportJob {
	jobs := make([]ImportJob, 0, len(s.queue))
	for _, entry := range s.queue {
		jobs = append(jobs, entry.ImportJob)
	}
	return jobs
}

func (s *Service) Schedule() bool {
	if s.active != "" || s.pending {
		return false
	}
	for _, entry := range s.queue {
		if entry.State == "queued" {
			s.pending = true
			return true
		}
	}
	return false
}

func (s *Service) Next() string {
	if s.active != "" {
		return ""
	}
	for _, entry := range s.queue {
		if entry.State == "queued" {
			s.active = entry.ID
			entry.State, entry.Message, entry.Progress = "preparing", "Decoding…", -1
			return entry.ID
		}
	}
	return ""
}

func (s *Service) find(id string) *job {
	for _, entry := range s.queue {
		if entry.ID == id {
			return entry
		}
	}
	return nil
}

func (s *Service) FailStart(id string, err error) {
	entry := s.find(id)
	entry.State, entry.Message, entry.Error = "failed", err.Error(), err.Error()
	s.active = ""
}

func (s *Service) Begin(id string) Execution {
	entry := s.find(id)
	work := Execution{source: entry.source, decoder: entry.decoder}
	if s.installApproved {
		work.install = s.installer
		s.installApproved, s.installer = false, nil
		entry.installer = work.install
	}
	if work.install != nil {
		entry.Message = "Downloading audio support…"
	}
	return work
}

// DownloadProgress returns the public progress and whether to publish it. The
// application's status uses a 0..1 scale; queue snapshots use 0..100.
func (s *Service) DownloadProgress(id string, n, total int64, now time.Time) (float64, bool) {
	entry := s.find(id)
	if total > 0 {
		entry.Progress = min(100, float64(n)*100/float64(total))
	}
	if n == total {
		entry.Message = "Installing audio support…"
	}
	if now.Sub(entry.lastProgress) < 250*time.Millisecond && n != total {
		return entry.Progress, false
	}
	entry.lastProgress = now
	return entry.Progress, true
}

func (s *Service) Decoding(id string) {
	entry := s.find(id)
	entry.Message, entry.Progress = "Decoding…", -1
}

func (s *Service) Transcribing(id string) {
	entry := s.find(id)
	entry.State, entry.Message, entry.Progress = "transcribing", "Transcribing…", -1
	entry.lastProgress = time.Time{}
}

func (s *Service) Progress(id string, progress float64, now time.Time) bool {
	entry := s.find(id)
	if entry == nil || s.active != id || entry.State != "transcribing" || math.IsNaN(progress) || math.IsInf(progress, 0) {
		return false
	}
	entry.Progress = max(entry.Progress, min(100, max(0, progress)))
	if now.Sub(entry.lastProgress) < 250*time.Millisecond && progress < 100 {
		return false
	}
	entry.lastProgress = now
	return true
}

func (s *Service) Processing(id string) bool {
	if s.active == "" || id != s.active {
		return false
	}
	entry := s.find(id)
	if entry.State == "processing" {
		return false
	}
	entry.State, entry.Message, entry.Progress = "processing", "Processing text…", -1
	return true
}

func (s *Service) Finish(id, sessionID, transcript, message string, cancelled bool, err error) {
	entry := s.find(id)
	entry.SessionID, entry.Transcript = sessionID, transcript
	switch {
	case transcript != "":
		entry.State, entry.Message, entry.Progress = "done", message, 100
	case cancelled || errors.Is(err, context.Canceled):
		entry.State, entry.Message, entry.Progress = "cancelled", "Cancelled", -1
	case err != nil:
		entry.State, entry.Message, entry.Error, entry.Progress = "failed", redactError(entry.source, err), redactError(entry.source, err), -1
	default:
		entry.State, entry.Message, entry.Progress = "cancelled", "Cancelled", -1
	}
	s.active = ""
}

func (s *Service) Reorder(ids []string) error {
	queued := make(map[string]*job)
	for _, entry := range s.queue {
		if entry.State == "queued" {
			queued[entry.ID] = entry
		}
	}
	if len(ids) != len(queued) {
		return errors.New("reorder must include every queued import exactly once")
	}
	order := make([]*job, 0, len(ids))
	for _, id := range ids {
		entry, ok := queued[id]
		if !ok {
			return errors.New("only queued imports can be reordered, without duplicate or unknown IDs")
		}
		order = append(order, entry)
		delete(queued, id)
	}
	n := 0
	for i, entry := range s.queue {
		if entry.State == "queued" {
			s.queue[i] = order[n]
			n++
		}
	}
	return nil
}

// Remove returns true when the caller must cancel the active operation.
func (s *Service) Remove(id string) (bool, error) {
	for i, entry := range s.queue {
		if entry.ID != id {
			continue
		}
		if id == s.active {
			entry.Message = "Cancelling…"
			return true, nil
		}
		if entry.State != "queued" {
			return false, errors.New("only queued or active imports can be removed")
		}
		s.queue = append(s.queue[:i], s.queue[i+1:]...)
		return false, nil
	}
	return false, errors.New("import not found")
}

func (s *Service) ClearFinished() {
	jobs := make([]*job, 0, len(s.queue))
	for _, entry := range s.queue {
		if entry.State != "done" && entry.State != "failed" && entry.State != "cancelled" {
			jobs = append(jobs, entry)
		}
	}
	s.queue = jobs
}

// Retry keeps a stable job identity across unlocked decoder probing. ApplyRetry
// revalidates membership and terminal state after the caller reacquires its lock.
type Retry struct {
	entry     *job
	resolve   Resolver
	source    string
	installer Installer
}
type RetryResult struct {
	decoder      string
	err          error
	needsInstall bool
}

func (s *Service) Retry(id string) (Retry, error) {
	entry := s.find(id)
	if entry == nil {
		return Retry{}, errors.New("import not found")
	}
	if entry.State != "failed" && entry.State != "cancelled" {
		return Retry{}, errors.New("only failed or cancelled imports can be retried")
	}
	return Retry{entry: entry, resolve: entry.resolve, source: entry.source, installer: entry.installer}, nil
}

func (r Retry) Prepare(ctx context.Context, managedDecoder string) RetryResult {
	resolve := r.resolve
	if resolve == nil {
		resolve = audio.ImportDecoder
	}
	decoder, err := resolve(ctx, r.source, managedDecoder)
	return RetryResult{decoder: decoder, err: err, needsInstall: errors.Is(err, audio.ErrFFmpegMissing) && r.installer != nil}
}

func (s *Service) ApplyRetry(retry Retry, result RetryResult) (bool, error) {
	entry := retry.entry
	if s.find(entry.ID) != entry {
		return false, errors.New("import not found")
	}
	if entry.State != "failed" && entry.State != "cancelled" {
		return false, errors.New("only failed or cancelled imports can be retried")
	}
	if result.err != nil && !result.needsInstall {
		entry.State, entry.Message, entry.Error, entry.Progress = "failed", redactError(entry.source, result.err), redactError(entry.source, result.err), -1
		return false, nil
	}
	if result.needsInstall && !s.installApproved {
		s.installApproved, s.installer = true, retry.installer
	}
	entry.decoder = result.decoder
	entry.State, entry.Message, entry.Error, entry.Progress = "queued", "Queued", "", -1
	entry.lastProgress = time.Time{}
	return true, nil
}

func redactError(source string, err error) string {
	if source == "" {
		return err.Error()
	}
	return strings.ReplaceAll(err.Error(), source, filepath.Base(source))
}
