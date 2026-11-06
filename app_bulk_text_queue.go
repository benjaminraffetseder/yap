package main

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	textmodel "yap/internal/inference/text"
)

type BulkTextRequest struct {
	Selection     TranscriptExportSelection `json:"selection"`
	Action        string                    `json:"action"` // title or output
	PromptID      string                    `json:"promptId"`
	ReplaceTitles bool                      `json:"replaceTitles"`
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

type bulkTextJob struct {
	BulkTextJob
	request textRequest
}

// Queue only identifiers and a frozen model/prompt configuration. Transcripts
// are read when each job starts; deleting an entry cannot resurrect its data.
func (a *App) QueueBulkText(request BulkTextRequest) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return 0, err
	}
	if request.Action != "title" && request.Action != "output" {
		return 0, errors.New("choose title generation or a saved prompt or chain")
	}
	if request.Action == "title" {
		request.PromptID = ""
	}
	config, err := textmodel.Normalize(a.textConfig)
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
	entries, err := a.selectedHistoryLocked(request.Selection)
	if err != nil {
		return 0, err
	}
	jobs := make([]*bulkTextJob, 0, len(entries))
	for _, entry := range entries {
		if request.Action == "title" && !request.ReplaceTitles && entry.Title != "" {
			continue
		}
		duplicate := false
		for _, job := range a.bulkTextQueue {
			if (job.State == "queued" || job.State == "running") && job.SessionID == entry.ID && job.Action == request.Action && job.request.promptID == request.PromptID {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		name := entry.Title
		if name == "" {
			preview := []rune(strings.Join(strings.Fields(entry.FinalTranscript), " "))
			name = string(preview[:min(80, len(preview))])
		}
		job := &bulkTextJob{BulkTextJob: BulkTextJob{ID: uuid.NewString(), SessionID: entry.ID, Name: name, Action: request.Action, Prompt: promptName, State: "queued"}}
		job.request = textRequest{config: &config, promptID: request.PromptID}
		if request.Action == "title" {
			job.request.titleSessionID = entry.ID
			job.request.saveTitle = true
			job.request.expectedTitle = entry.Title
		} else {
			job.request.target = &outputTarget{sessionID: entry.ID}
		}
		jobs = append(jobs, job)
	}
	a.bulkTextQueue = append(a.bulkTextQueue, jobs...)
	a.emitBulkTextQueueLocked()
	a.pumpBulkTextQueueLocked()
	return len(jobs), nil
}

func (a *App) bulkTextSnapshotLocked() []BulkTextJob {
	jobs := make([]BulkTextJob, 0, len(a.bulkTextQueue))
	for _, job := range a.bulkTextQueue {
		jobs = append(jobs, job.BulkTextJob)
	}
	return jobs
}

func (a *App) emitBulkTextQueueLocked() {
	if !a.closing {
		a.event("text:queue", a.bulkTextSnapshotLocked())
	}
}

func (a *App) pumpBulkTextQueueLocked() {
	if a.closing || a.busy() || a.textJobID != "" || a.bulkTextActive != "" || a.bulkTextPumpPending || a.importPumpPending {
		return
	}
	for _, job := range a.bulkTextQueue {
		if job.State == "queued" {
			a.bulkTextPumpPending = true
			a.wg.Add(1)
			go a.startNextBulkText()
			return
		}
	}
}

func (a *App) startNextBulkText() {
	defer a.wg.Done()
	a.mu.Lock()
	a.bulkTextPumpPending = false
	if a.closing || a.busy() || a.textJobID != "" || a.bulkTextActive != "" || a.importPumpPending {
		a.mu.Unlock()
		return
	}
	var next *bulkTextJob
	for _, job := range a.bulkTextQueue {
		if job.State == "queued" {
			next = job
			break
		}
	}
	if next == nil {
		a.mu.Unlock()
		return
	}
	a.bulkTextActive, next.State = next.ID, "running"
	a.emitBulkTextQueueLocked()
	_, err := a.processTextRequestLocked(next.ID, next.request)
	a.mu.Lock()
	defer a.mu.Unlock()
	a.bulkTextActive = ""
	switch {
	case a.closing || errors.Is(err, context.Canceled):
		next.State = "cancelled"
	case err != nil:
		next.State, next.Error = "failed", err.Error()
	default:
		next.State = "done"
	}
	a.emitBulkTextQueueLocked()
	a.emit()
}

// Cancel all outstanding work. Completed chain steps and earlier jobs remain saved.
func (a *App) CancelBulkTextQueue() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, job := range a.bulkTextQueue {
		if job.State == "queued" {
			job.State = "cancelled"
		}
		if job.State == "running" && a.textJobID == job.ID && a.textCancel != nil {
			a.textCancel()
		}
	}
	a.emitBulkTextQueueLocked()
}

func (a *App) ClearFinishedBulkTextJobs() {
	a.mu.Lock()
	defer a.mu.Unlock()
	jobs := make([]*bulkTextJob, 0, len(a.bulkTextQueue))
	for _, job := range a.bulkTextQueue {
		if job.State == "queued" || job.State == "running" {
			jobs = append(jobs, job)
		}
	}
	a.bulkTextQueue = jobs
	a.emitBulkTextQueueLocked()
}
