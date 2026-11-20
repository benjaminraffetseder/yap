// Package bulktext owns saved-transcript job selection and queue state. Service
// methods use the application's operation lock and never start workers.
package bulktext

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"yap/internal/app/transcriptexport"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

type BulkTextRequest struct {
	Selection     transcriptexport.TranscriptExportSelection `json:"selection"`
	Action        string                                     `json:"action"`
	PromptID      string                                     `json:"promptId"`
	ReplaceTitles bool                                       `json:"replaceTitles"`
}

type BulkTextJob struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	Name      string `json:"name"`
	Action    string `json:"action"`
	Prompt    string `json:"prompt"`
	State     string `json:"state"`
	Error     string `json:"error"`
}

// Execution stores identifiers and a frozen configuration. Transcript contents
// are deliberately resolved by text processing when the job actually starts.
type Execution struct {
	ID              string
	Config          *textmodel.Config
	PromptID        string
	TitleSessionID  string
	SaveTitle       bool
	ExpectedTitle   string
	OutputSessionID string
}

type job struct {
	BulkTextJob
	execution Execution
}
type Service struct {
	queue   []*job
	active  string
	pending bool
}

func (s *Service) ActiveID() string { return s.active }
func (s *Service) Pending() bool    { return s.pending }
func (s *Service) ResetPending()    { s.pending = false }

func (s *Service) Enqueue(store *storage.Store, saved textmodel.Config, request BulkTextRequest) (int, error) {
	if request.Action != "title" && request.Action != "output" {
		return 0, errors.New("choose title generation or a saved prompt or chain")
	}
	if request.Action == "title" {
		request.PromptID = ""
	}
	config, err := textmodel.Normalize(saved)
	if err != nil {
		return 0, err
	}
	if !config.Enabled {
		return 0, errors.New("enable a local text model in Prompts first")
	}
	promptName := ""
	if request.Action == "output" {
		recipe, err := config.Recipe(request.PromptID)
		if err != nil {
			return 0, err
		}
		promptName = recipe.Name
		if promptName == "" {
			prompt, _ := config.Prompt(request.PromptID)
			promptName = prompt.Name
		}
	}
	entries, err := transcriptexport.Select(store, request.Selection)
	if err != nil {
		return 0, err
	}
	jobs := make([]*job, 0, len(entries))
	for _, entry := range entries {
		if request.Action == "title" && !request.ReplaceTitles && entry.Title != "" {
			continue
		}
		duplicate := false
		for _, pending := range s.queue {
			if (pending.State == "queued" || pending.State == "running") && pending.SessionID == entry.ID && pending.Action == request.Action && pending.execution.PromptID == request.PromptID {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		var next *job
		if request.Action == "title" {
			next = titleJob(entry, config)
		} else {
			id := uuid.NewString()
			next = &job{BulkTextJob: BulkTextJob{ID: id, SessionID: entry.ID, Name: entryName(entry), Action: request.Action, Prompt: promptName, State: "queued"}, execution: Execution{ID: id, Config: &config, PromptID: request.PromptID, OutputSessionID: entry.ID}}
		}
		jobs = append(jobs, next)
	}
	s.queue = append(s.queue, jobs...)
	return len(jobs), nil
}

func entryName(entry storage.Session) string {
	if entry.Title != "" {
		return entry.Title
	}
	preview := []rune(strings.Join(strings.Fields(entry.FinalTranscript), " "))
	return string(preview[:min(80, len(preview))])
}

func titleJob(entry storage.Session, config textmodel.Config) *job {
	id := uuid.NewString()
	return &job{BulkTextJob: BulkTextJob{ID: id, SessionID: entry.ID, Name: entryName(entry), Action: "title", State: "queued"}, execution: Execution{ID: id, Config: &config, TitleSessionID: entry.ID, SaveTitle: true, ExpectedTitle: entry.Title}}
}

func (s *Service) EnqueueTitle(entry storage.Session, config textmodel.Config) {
	s.queue = append(s.queue, titleJob(entry, config))
}

func (s *Service) Snapshot() []BulkTextJob {
	jobs := make([]BulkTextJob, 0, len(s.queue))
	for _, entry := range s.queue {
		jobs = append(jobs, entry.BulkTextJob)
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

func (s *Service) Next() *Execution {
	if s.active != "" {
		return nil
	}
	for _, entry := range s.queue {
		if entry.State == "queued" {
			s.active, entry.State = entry.ID, "running"
			work := entry.execution
			return &work
		}
	}
	return nil
}

func (s *Service) Finish(id string, closing bool, err error) {
	s.active = ""
	for _, entry := range s.queue {
		if entry.ID != id {
			continue
		}
		switch {
		case closing || errors.Is(err, context.Canceled):
			entry.State = "cancelled"
		case err != nil:
			entry.State, entry.Error = "failed", err.Error()
		default:
			entry.State = "done"
		}
		return
	}
}

// Cancel marks waiting jobs and returns the running identity whose inference
// cancellation is owned by the application.
func (s *Service) Cancel() string {
	for _, entry := range s.queue {
		if entry.State == "queued" {
			entry.State = "cancelled"
		}
	}
	return s.active
}

func (s *Service) ClearFinished() {
	jobs := make([]*job, 0, len(s.queue))
	for _, entry := range s.queue {
		if entry.State == "queued" || entry.State == "running" {
			jobs = append(jobs, entry)
		}
	}
	s.queue = jobs
}
