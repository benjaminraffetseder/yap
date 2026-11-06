package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"yap/internal/storage"
)

func addBulkSession(t *testing.T, a *App, id string) storage.Session {
	t.Helper()
	entry := storage.NewSession(id, 1000, "Bulk transcript "+id, "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	return entry
}

func resumeBulkQueue(a *App) {
	a.mu.Lock()
	a.status.Phase = "idle"
	a.emit()
	a.mu.Unlock()
}

func TestBulkTextTitlesAcrossUnloadedMatchesKeepExistingAndExclusions(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	a.textEngine = &fakeTextEngine{output: "\"Generated title\""}
	for i := range 55 {
		addBulkSession(t, a, fmt.Sprintf("bulk-%02d", i))
	}
	if err := a.store.SaveSessionTitle("bulk-00", "Keep this title"); err != nil {
		t.Fatal(err)
	}
	a.status.Phase = "recording"
	request := BulkTextRequest{Action: "title", Selection: TranscriptExportSelection{AllMatching: true, Query: "Bulk", ExcludedSessionIDs: []string{"bulk-01"}}}
	count, err := a.QueueBulkText(request)
	if err != nil || count != 53 || a.bulkTextActive != "" {
		t.Fatalf("incorrect queued selection: %d %v", count, err)
	}
	if count, err := a.QueueBulkText(request); err != nil || count != 0 {
		t.Fatal("duplicate pending jobs queued", count, err)
	}
	snapshot, err := a.GetSnapshot()
	if err != nil || len(snapshot.BulkTextQueue) != 53 || snapshot.BulkTextQueue[0].State != "queued" {
		t.Fatal("snapshot lost queued work", err)
	}
	resumeBulkQueue(a)
	a.wg.Wait()
	for i := range 55 {
		entry, err := a.store.Session(fmt.Sprintf("bulk-%02d", i))
		want := "Generated title"
		if i == 0 {
			want = "Keep this title"
		} else if i == 1 {
			want = ""
		}
		if err != nil || entry.Title != want || entry.FinalTranscript != "Bulk transcript "+entry.ID {
			t.Fatal("title or transcript changed incorrectly", entry, err)
		}
	}
	if a.bulkTextActive != "" || a.status.Phase != "idle" {
		t.Fatal("queue leaked active ownership")
	}
	a.ClearFinishedBulkTextJobs()
	if len(a.bulkTextQueue) != 0 {
		t.Fatal("finished queue not cleared")
	}
}

func TestBulkTextPromptsChainsFailureContinuesAndFreezesConfiguration(t *testing.T) {
	a := testApp(t)
	config := enableChain(t, a, false)
	first := addBulkSession(t, a, "first")
	second := addBulkSession(t, a, "second")
	engine := &chainTextEngine{process: func(index int, _ context.Context) (string, error) {
		if index == 2 {
			return "", errors.New("model failed on chain step")
		}
		return fmt.Sprintf("result %d", index+1), nil
	}}
	a.textEngine = engine
	a.status.Phase = "recording"
	if _, err := a.QueueBulkText(BulkTextRequest{Action: "output", PromptID: "follow-up", Selection: TranscriptExportSelection{SessionIDs: []string{first.ID}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.QueueBulkText(BulkTextRequest{Action: "output", PromptID: "summary", Selection: TranscriptExportSelection{SessionIDs: []string{second.ID}}}); err != nil {
		t.Fatal(err)
	}
	a.status.Phase = "idle"
	config.Model = "changed-model"
	config.Prompts[1].Instruction = "Changed summary instructions"
	if _, err := a.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	resumeBulkQueue(a)
	a.wg.Wait()
	jobs := a.bulkTextSnapshotLocked()
	if len(jobs) != 2 || jobs[0].State != "failed" || !strings.Contains(jobs[0].Error, "completed results are kept") || jobs[1].State != "done" {
		t.Fatal("failure stopped queue or was hidden", jobs)
	}
	outputs, _ := a.GetSessionOutputs(first.ID)
	if len(outputs) != 2 || outputs[0].Chain.RunID == "" {
		t.Fatal("completed chain steps lost", outputs)
	}
	outputs, _ = a.GetSessionOutputs(second.ID)
	if len(outputs) != 1 || outputs[0].Input != second.FinalTranscript || outputs[0].Model != "custom-local-model" || outputs[0].Prompt.Instruction == config.Prompts[1].Instruction {
		t.Fatal("queue did not freeze prompt/model or save output", outputs)
	}
}

func TestBulkTextCancellationKeepsCompletedChainSteps(t *testing.T) {
	a := testApp(t)
	enableChain(t, a, false)
	first := addBulkSession(t, a, "first")
	second := addBulkSession(t, a, "second")
	started := make(chan struct{}, 1)
	a.textEngine = &chainTextEngine{process: func(index int, ctx context.Context) (string, error) {
		if index == 0 {
			return "Completed first step", nil
		}
		started <- struct{}{}
		<-ctx.Done()
		return "", ctx.Err()
	}}
	if _, err := a.QueueBulkText(BulkTextRequest{Action: "output", PromptID: "follow-up", Selection: TranscriptExportSelection{SessionIDs: []string{first.ID, second.ID}}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("chain did not start")
	}
	a.ClearFinishedBulkTextJobs() // Must keep the active and queued jobs.
	a.CancelBulkTextQueue()
	a.wg.Wait()
	for _, job := range a.bulkTextSnapshotLocked() {
		if job.State != "cancelled" {
			t.Fatal("outstanding job not cancelled", job)
		}
	}
	outputs, _ := a.GetSessionOutputs(first.ID)
	other, _ := a.GetSessionOutputs(second.ID)
	if len(outputs) != 1 || len(other) != 0 {
		t.Fatal("cancellation lost completed work or started the next transcript")
	}
}

func TestBulkTextTitleProtectsConcurrentEditsAndDeletedEntries(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	first := addBulkSession(t, a, "first")
	second := addBulkSession(t, a, "second")
	if err := a.RenameSession(first.ID, "Old title"); err != nil {
		t.Fatal(err)
	}
	engine := &fakeTextEngine{output: "New title", started: make(chan textCall, 2), release: make(chan struct{})}
	a.textEngine = engine
	if count, err := a.QueueBulkText(BulkTextRequest{Action: "title", ReplaceTitles: true, Selection: TranscriptExportSelection{SessionIDs: []string{first.ID, second.ID}}}); err != nil || count != 2 {
		t.Fatal(count, err)
	}
	select {
	case <-engine.started:
	case <-time.After(5 * time.Second):
		t.Fatal("title job did not start")
	}
	if err := a.RenameSession(first.ID, "Manual title"); err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteSessions([]string{second.ID}); err != nil {
		t.Fatal(err)
	}
	close(engine.release)
	a.wg.Wait()
	entry, _ := a.store.Session(first.ID)
	if entry.Title != "Manual title" {
		t.Fatal("manual edit overwritten")
	}
	for _, job := range a.bulkTextSnapshotLocked() {
		if job.State != "failed" || job.Error == "" {
			t.Fatal("edit conflict or deleted entry was hidden", job)
		}
	}
}

func TestBulkTextResumesAfterAudioImportAndShutdownCancels(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	entry := addBulkSession(t, a, "queued")
	speech := queueSpeech{make(chan string, 1), make(chan error)}
	a.engine = speech
	text := &fakeTextEngine{started: make(chan textCall, 1), release: make(chan struct{})}
	a.textEngine = text
	if err := a.ImportDroppedAudio([]string{importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	nextQueueStart(t, speech.started)
	if _, err := a.QueueBulkText(BulkTextRequest{Action: "title", Selection: TranscriptExportSelection{SessionIDs: []string{entry.ID}}}); err != nil {
		t.Fatal(err)
	}
	speech.release <- nil
	select {
	case <-text.started:
	case <-time.After(5 * time.Second):
		t.Fatal("bulk queue did not resume after import")
	}
	a.shutdown(a.ctx)
	if a.bulkTextQueue[0].State != "cancelled" || a.bulkTextActive != "" {
		t.Fatal("shutdown did not cancel active bulk job")
	}
}

func TestBulkTextRejectsInvalidSelectionsBeforeQueueing(t *testing.T) {
	a := testApp(t)
	entry := addBulkSession(t, a, "one")
	request := BulkTextRequest{Action: "title", Selection: TranscriptExportSelection{SessionIDs: []string{entry.ID}}}
	if _, err := a.QueueBulkText(request); err == nil {
		t.Fatal("accepted disabled text model")
	}
	enableText(t, a, false)
	for _, invalid := range []BulkTextRequest{
		{Action: "unknown", Selection: request.Selection},
		{Action: "output", PromptID: "missing", Selection: request.Selection},
		{Action: "title", Selection: TranscriptExportSelection{SessionIDs: []string{entry.ID, "missing"}}},
		{Action: "title", Selection: TranscriptExportSelection{SessionIDs: []string{entry.ID}, AllMatching: true}},
	} {
		if _, err := a.QueueBulkText(invalid); err == nil || len(a.bulkTextQueue) != 0 {
			t.Fatal("invalid request partially queued", invalid, err)
		}
	}
}

func TestBulkTextResumesWhenScheduledImportsWereRemoved(t *testing.T) {
	a := testApp(t)
	enableText(t, a, false)
	entry := addBulkSession(t, a, "queued")
	a.textEngine = &fakeTextEngine{output: "A title"}
	a.importPumpPending = true
	if _, err := a.QueueBulkText(BulkTextRequest{Action: "title", Selection: TranscriptExportSelection{SessionIDs: []string{entry.ID}}}); err != nil {
		t.Fatal(err)
	}
	// Simulate an already scheduled worker finding its imports removed.
	a.wg.Add(1)
	a.startNextImport()
	a.wg.Wait()
	if a.bulkTextQueue[0].State != "done" {
		t.Fatal("text queue stalled after an empty import worker")
	}
}
