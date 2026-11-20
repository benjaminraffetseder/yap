package bulktext_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"yap/internal/app/bulktext"
	"yap/internal/app/transcriptexport"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func savedSessions(t *testing.T) (*storage.Store, textmodel.Config) {
	t.Helper()
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	for _, id := range []string{"first", "second", "third"} {
		if err := store.Add(storage.NewSession(id, 1000, strings.Repeat("説明 ", 90)+id, "base", "en", "")); err != nil {
			t.Fatal(err)
		}
	}
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "frozen-model"
	return store, config
}

func selection(ids ...string) transcriptexport.TranscriptExportSelection {
	return transcriptexport.TranscriptExportSelection{SessionIDs: ids}
}

func TestEnqueueResolvesSelectionAtomicallyAndFreezesModelAndPrompt(t *testing.T) {
	store, config := savedSessions(t)
	var service bulktext.Service
	if service.Snapshot() == nil {
		t.Fatal("empty queue must serialize as an array")
	}
	for _, request := range []bulktext.BulkTextRequest{
		{Action: "unknown", Selection: selection("first")},
		{Action: "output", PromptID: "missing", Selection: selection("first")},
		{Action: "title", Selection: selection("first", "missing")},
		{Action: "title", Selection: transcriptexport.TranscriptExportSelection{AllMatching: true, SessionIDs: []string{"first"}}},
	} {
		if _, err := service.Enqueue(store, config, request); err == nil || len(service.Snapshot()) != 0 {
			t.Fatal("invalid selection partially queued", request, err)
		}
	}
	request := bulktext.BulkTextRequest{Action: "output", PromptID: "summary", Selection: selection("first", "second")}
	if count, err := service.Enqueue(store, config, request); err != nil || count != 2 {
		t.Fatal(count, err)
	}
	snapshot := service.Snapshot()
	if len([]rune(snapshot[0].Name)) != 80 || snapshot[0].Prompt != "Summary" {
		t.Fatal(snapshot)
	}
	snapshot[0].State = "done"
	if service.Snapshot()[0].State != "queued" {
		t.Fatal("snapshot shared queue state")
	}
	config.Model, config.Prompts[1].Instruction = "changed-model", "Changed instructions"
	if count, err := service.Enqueue(store, config, request); err != nil || count != 0 {
		t.Fatal("duplicate queued jobs accepted", count, err)
	}
	if !service.Schedule() || service.Schedule() {
		t.Fatal("worker scheduled twice")
	}
	service.ResetPending()
	work := service.Next()
	if work == nil || work.OutputSessionID != "first" || work.Config.Model != "frozen-model" || work.Config.Prompts[1].Instruction == config.Prompts[1].Instruction {
		t.Fatal("model/prompt changed while queued", work)
	}
	if service.Next() != nil {
		t.Fatal("claimed concurrent worker")
	}
	if count, err := service.Enqueue(store, config, request); err != nil || count != 0 {
		t.Fatal("duplicate running job accepted", count, err)
	}
	service.Finish(work.ID, false, errors.New("model failed"))
	if count, err := service.Enqueue(store, config, request); err != nil || count != 1 {
		t.Fatal("terminal job blocked explicit retry", count, err)
	}
	if next := service.Next(); next == nil || next.OutputSessionID != "second" {
		t.Fatal("retry reordered waiting entries", next)
	}
}

func TestTitleQueueKeepsExistingTitlesAndCancellationKeepsActiveOwnership(t *testing.T) {
	store, config := savedSessions(t)
	if err := store.SaveSessionTitle("first", "Existing title"); err != nil {
		t.Fatal(err)
	}
	var service bulktext.Service
	request := bulktext.BulkTextRequest{Action: "title", PromptID: "ignored", Selection: transcriptexport.TranscriptExportSelection{AllMatching: true, ExcludedSessionIDs: []string{"third"}}}
	if count, err := service.Enqueue(store, config, request); err != nil || count != 1 {
		t.Fatal("existing or excluded title was queued", count, err)
	}
	request.ReplaceTitles = true
	if count, err := service.Enqueue(store, config, request); err != nil || count != 1 {
		t.Fatal("replacement or deduplication failed", count, err)
	}
	work := service.Next()
	if work == nil || !work.SaveTitle || work.TitleSessionID != "second" || work.PromptID != "" {
		t.Fatal("wrong title operation", work)
	}
	active := service.Cancel()
	service.ClearFinished()
	if active != work.ID || service.ActiveID() != work.ID || len(service.Snapshot()) != 1 || service.Snapshot()[0].State != "running" {
		t.Fatal("cancel dropped active ownership")
	}
	service.Finish(work.ID, false, context.Canceled)
	if service.Snapshot()[0].State != "cancelled" || service.ActiveID() != "" || service.Schedule() {
		t.Fatal("cancelled work remained runnable")
	}
	service.ClearFinished()
	if snapshot := service.Snapshot(); snapshot == nil || len(snapshot) != 0 {
		t.Fatal(snapshot)
	}
	entry, err := store.Session("first")
	if err != nil {
		t.Fatal(err)
	}
	service.EnqueueTitle(entry, config)
	work = service.Next()
	if work.ExpectedTitle != "Existing title" || work.TitleSessionID != entry.ID || work.Config.Model != config.Model {
		t.Fatal("automatic title lost edit guard or captured model", work)
	}
	service.Finish(work.ID, true, nil)
	if service.Snapshot()[0].State != "cancelled" {
		t.Fatal("shutdown published success")
	}
}
