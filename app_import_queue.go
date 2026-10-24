package main

import (
	"errors"
	"math"
	"time"
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

type importJob struct {
	ImportJob
	source, decoder string
	installer       audioSupportInstaller
	lastProgress    time.Time
}

func (a *App) importSnapshotLocked() []ImportJob {
	jobs := make([]ImportJob, 0, len(a.importQueue))
	for _, job := range a.importQueue {
		jobs = append(jobs, job.ImportJob)
	}
	return jobs
}

func (a *App) emitImportQueueLocked() {
	if !a.closing {
		a.event("import:queue", a.importSnapshotLocked())
	}
}

func (a *App) pumpImportQueueLocked() {
	if a.closing || a.busy() || a.textJobID != "" || a.importActive != "" || a.importPumpPending {
		return
	}
	for _, job := range a.importQueue {
		if job.State == "queued" {
			a.importPumpPending = true
			// Include the scheduled start in shutdown's wait before unlocking.
			a.wg.Add(1)
			go a.startNextImport()
			return
		}
	}
}

func (a *App) startNextImport() {
	defer a.wg.Done()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.importPumpPending = false
	if a.closing || a.busy() || a.textJobID != "" || a.importActive != "" {
		return
	}
	for _, job := range a.importQueue {
		if job.State != "queued" {
			continue
		}
		a.importActive = job.ID
		job.State, job.Message, job.Progress = "preparing", "Decoding…", -1
		if err := a.importAudioWithDecoder(job); err != nil {
			job.State, job.Message, job.Error = "failed", err.Error(), err.Error()
			a.importActive = ""
			a.emitImportQueueLocked()
			a.pumpImportQueueLocked()
		}
		return
	}
}

func (a *App) importProgress(job *importJob, progress float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing || a.importActive != job.ID || job.State != "transcribing" || math.IsNaN(progress) || math.IsInf(progress, 0) {
		return
	}
	job.Progress = max(job.Progress, min(100, max(0, progress)))
	if time.Since(job.lastProgress) < 250*time.Millisecond && progress < 100 {
		return
	}
	job.lastProgress = time.Now()
	a.emitImportQueueLocked()
}

func (a *App) importProcessingLocked() {
	if a.importActive == "" || a.status.ImportID != a.importActive {
		return
	}
	for _, job := range a.importQueue {
		if job.ID == a.importActive && job.State != "processing" {
			job.State, job.Message, job.Progress = "processing", "Processing text…", -1
			a.emitImportQueueLocked()
		}
	}
}

func (a *App) ReorderImportQueue(ids []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	queued := make(map[string]*importJob)
	for _, job := range a.importQueue {
		if job.State == "queued" {
			queued[job.ID] = job
		}
	}
	if len(ids) != len(queued) {
		return errors.New("reorder must include every queued import exactly once")
	}
	order := make([]*importJob, 0, len(ids))
	for _, id := range ids {
		job, ok := queued[id]
		if !ok {
			return errors.New("only queued imports can be reordered, without duplicate or unknown IDs")
		}
		order = append(order, job)
		delete(queued, id)
	}
	n := 0
	for i, job := range a.importQueue {
		if job.State == "queued" {
			a.importQueue[i] = order[n]
			n++
		}
	}
	a.emitImportQueueLocked()
	return nil
}

func (a *App) RemoveImport(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	for i, job := range a.importQueue {
		if job.ID != id {
			continue
		}
		if id == a.importActive {
			if a.cancel != nil {
				a.cancel()
			}
			job.Message = "Cancelling…"
		} else if job.State == "queued" {
			a.importQueue = append(a.importQueue[:i], a.importQueue[i+1:]...)
		} else {
			return errors.New("only queued or active imports can be removed")
		}
		a.emitImportQueueLocked()
		return nil
	}
	return errors.New("import not found")
}

func (a *App) RetryImport(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.importAvailableLocked(); err != nil {
		return err
	}
	for _, job := range a.importQueue {
		if job.ID != id {
			continue
		}
		if job.State != "failed" && job.State != "cancelled" {
			return errors.New("only failed or cancelled imports can be retried")
		}
		job.State, job.Message, job.Error, job.Progress = "queued", "Queued", "", -1
		job.lastProgress = time.Time{}
		a.emitImportQueueLocked()
		a.pumpImportQueueLocked()
		return nil
	}
	return errors.New("import not found")
}

func (a *App) ClearFinishedImports() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	jobs := make([]*importJob, 0, len(a.importQueue))
	for _, job := range a.importQueue {
		if job.State != "done" && job.State != "failed" && job.State != "cancelled" {
			jobs = append(jobs, job)
		}
	}
	a.importQueue = jobs
	a.emitImportQueueLocked()
	return nil
}
