package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

type fakeChatEngine struct {
	fakeTextEngine
	chat func(context.Context, []textmodel.Message, func(string)) (string, error)
}

func (f *fakeChatEngine) Chat(ctx context.Context, _ textmodel.Config, messages []textmodel.Message, emit func(string)) (string, error) {
	return f.chat(ctx, messages, emit)
}

func chatApp(t *testing.T) *App {
	t.Helper()
	a := testApp(t)
	enableText(t, a, false)
	entry := storage.NewSession("chat", 1000, "The deadline is Friday.\nAlex owns the launch.", "tiny", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.copyText = func(string) error { t.Error("chat touched clipboard"); return nil }
	return a
}

// Optional real-server proof. No user history, model settings or audio is used.
func TestChatLiveLocalModel(t *testing.T) {
	endpoint, model := os.Getenv("YAP_CHAT_ENDPOINT"), os.Getenv("YAP_CHAT_MODEL")
	if endpoint == "" || model == "" {
		t.Skip("set YAP_CHAT_ENDPOINT and YAP_CHAT_MODEL for a local-server smoke test")
	}
	a := chatApp(t)
	config := textmodel.Defaults()
	config.Enabled, config.Endpoint, config.Model = true, endpoint, model
	if _, err := a.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	a.textEngine = textmodel.Local{}
	chat, err := a.SendChatMessage("live-first", "chat", ChatRequest{Source: "transcript", Message: "What day is the deadline? Answer in one short sentence and cite the source passage."})
	if err != nil {
		t.Fatal(err)
	}
	first := chat.Messages[len(chat.Messages)-1]
	if first.State != "complete" || !strings.Contains(strings.ToLower(first.Content), "friday") || len(first.References) == 0 {
		t.Fatalf("first reply: state=%s text=%q error=%s", first.State, first.Content, first.Error)
	}
	if err := a.SaveTranscript("chat", "The deadline is Monday.\nAlex owns the launch."); err != nil {
		t.Fatal(err)
	}
	chat, err = a.SendChatMessage("live-second", "chat", ChatRequest{Source: "transcript", Message: "The source has been corrected. What day is the deadline now? Answer in one short sentence and cite the current source."})
	if err != nil {
		t.Fatal(err)
	}
	last := chat.Messages[len(chat.Messages)-1]
	if last.State != "complete" || !strings.Contains(strings.ToLower(last.Content), "monday") || len(last.References) == 0 {
		t.Fatalf("updated reply: state=%s text=%q error=%s", last.State, last.Content, last.Error)
	}
	// Seed synthetic earlier draft discussion to exercise real compaction without
	// asking the live model to generate many long, unnecessary replies.
	for i := 0; i < 4; i++ {
		for _, role := range []string{"user", "assistant"} {
			content := "Keep the launch email concise and polite."
			if role == "assistant" {
				content = strings.Repeat("Working draft: Alex owns the launch. Keep the follow-up concise and polite. ", 60)
			}
			chat.Messages = append(chat.Messages, storage.ChatMessage{ID: fmt.Sprintf("seed-%s-%d", role, i), Role: role, SourceID: last.SourceID, Content: content, State: "complete", CreatedAt: time.Now().Format(time.RFC3339Nano), References: []storage.ChatReference{}})
		}
	}
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}
	chat, err = a.SendChatMessage("live-compacted", "chat", ChatRequest{Source: "transcript", Message: "Who owns the launch, and what day is the deadline? Answer in one short sentence and cite the current source."})
	if err != nil {
		t.Fatal(err)
	}
	last = chat.Messages[len(chat.Messages)-1]
	if last.State != "complete" || chat.CompactedThrough == 0 || !strings.Contains(strings.ToLower(last.Content), "monday") || !strings.Contains(strings.ToLower(last.Content), "alex") || len(last.References) == 0 {
		t.Fatalf("compacted reply: state=%s compacted=%d text=%q error=%s", last.State, chat.CompactedThrough, last.Content, last.Error)
	}
	t.Log("Real local model answered both source versions and compacted history with validated passage references.")
}

func TestChatCompactsAgainWhenServerReportsContextLimit(t *testing.T) {
	a := chatApp(t)
	calls, summaries := 0, 0
	a.textEngine = &fakeChatEngine{chat: func(_ context.Context, m []textmodel.Message, emit func(string)) (string, error) {
		if emit == nil {
			summaries++
			return "The user is refining a short email.", nil
		}
		calls++
		if calls == 2 {
			return "", textmodel.ErrChatContext
		}
		return "A short email", nil
	}}
	if _, err := a.SendChatMessage("before", "chat", ChatRequest{Source: "transcript", Message: "Draft an email"}); err != nil {
		t.Fatal(err)
	}
	chat, err := a.SendChatMessage("after", "chat", ChatRequest{Source: "transcript", Message: "Shorter"})
	if err != nil || calls != 3 || summaries != 1 || chat.CompactedThrough != 2 || chat.Messages[3].State != "complete" || len(chat.Messages) != 4 {
		t.Fatal("context recovery did not compact and retry exactly once", calls, summaries, chat, err)
	}
}

func TestChatUsesCurrentSourceAndKeepsEarlierReferences(t *testing.T) {
	a := chatApp(t)
	calls := [][]textmodel.Message{}
	a.textEngine = &fakeChatEngine{chat: func(_ context.Context, m []textmodel.Message, emit func(string)) (string, error) {
		calls = append(calls, m)
		emit("Friday [[1]]")
		return "Friday [[1]]", nil
	}}
	first, err := a.SendChatMessage("first", "chat", ChatRequest{Message: "When?", Source: "transcript"})
	if err != nil || len(first.Messages) != 2 || len(first.Messages[1].References) != 1 {
		t.Fatal(first, err)
	}
	if err := a.SaveTranscript("chat", "The deadline is Monday.\nAlex owns the launch."); err != nil {
		t.Fatal(err)
	}
	second, err := a.SendChatMessage("second", "chat", ChatRequest{Message: "And now?", Source: "transcript"})
	if err != nil || len(second.Sources) != 2 || len(second.Messages) != 4 {
		t.Fatal(second, err)
	}
	if !strings.Contains(calls[1][0].Content, "Monday") || strings.Contains(calls[1][0].Content, "Friday") || second.Messages[1].SourceID == second.Messages[3].SourceID {
		t.Fatal("new turn did not use current source", calls[1])
	}
	if first.Messages[1].References[0].Quote != "The deadline is Friday." || second.Source(first.Messages[1].SourceID).Text != first.Sources[0].Text {
		t.Fatal("old citation changed")
	}
	entry, _ := a.store.Session("chat")
	if entry.RawTranscript == entry.FinalTranscript || entry.FinalTranscript != "The deadline is Monday.\nAlex owns the launch." {
		t.Fatal("chat modified transcription")
	}
	if a.textJobID != "" || a.status.Phase != "idle" {
		t.Fatal("text operation not released")
	}
}

func TestChatDiscussesSavedOutputWithOriginalSource(t *testing.T) {
	a := chatApp(t)
	output := storage.NewGeneratedOutput("chat", "Original source", "A draft launch email", a.textConfig, textmodel.Prompt{ID: "summary", Name: "Summary", Instruction: "Summarize"})
	if err := a.store.AddGeneratedOutput(output); err != nil {
		t.Fatal(err)
	}
	if err := a.SaveTranscript("chat", "The deadline is Monday."); err != nil {
		t.Fatal(err)
	}
	a.textEngine = &fakeChatEngine{chat: func(_ context.Context, m []textmodel.Message, _ func(string)) (string, error) {
		if !strings.Contains(m[0].Content, "Friday") || strings.Contains(m[0].Content, "Monday") || !strings.Contains(m[len(m)-1].Content, output.Text) {
			t.Error("output discussion did not use original source and saved draft", m)
		}
		return "A shorter draft", nil
	}}
	chat, err := a.SendChatMessage("discuss", "chat", ChatRequest{Source: "original", Message: "Shorten this email", OutputID: output.ID})
	if err != nil || chat.Messages[0].OutputText != output.Text || chat.Sources[0].Kind != "original" {
		t.Fatal(chat, err)
	}
}

func TestChatStopPersistsPartialReplyAndRetryUsesLatestSource(t *testing.T) {
	a := chatApp(t)
	started := make(chan struct{})
	a.textEngine = &fakeChatEngine{chat: func(ctx context.Context, m []textmodel.Message, emit func(string)) (string, error) {
		emit("Partial")
		close(started)
		<-ctx.Done()
		return "Partial", ctx.Err()
	}}
	done := make(chan error, 1)
	go func() {
		_, err := a.SendChatMessage("stop", "chat", ChatRequest{Message: "Draft it", Source: "transcript"})
		done <- err
	}()
	<-started
	if err := a.ClearSessionChat("chat"); err == nil {
		t.Fatal("cleared an active conversation")
	}
	if err := a.SaveTranscript("chat", "The deadline is Monday."); err != nil {
		t.Fatal(err)
	}
	a.CancelTextProcessing("stop")
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	chat, err := a.GetSessionChat("chat")
	if err != nil || chat.Messages[1].State != "cancelled" || chat.Messages[1].Content != "Partial" {
		t.Fatal(chat, err)
	}
	a.textEngine = &fakeChatEngine{chat: func(_ context.Context, m []textmodel.Message, emit func(string)) (string, error) {
		if !strings.Contains(m[0].Content, "Monday") {
			t.Error("stale retry")
		}
		return "A complete draft", nil
	}}
	chat, err = a.SendChatMessage("retry", "chat", ChatRequest{Retry: true})
	if err != nil || len(chat.Messages) != 2 || chat.Messages[1].State != "complete" || chat.Messages[0].Content != "Draft it" {
		t.Fatal(chat, err)
	}
}

func TestChatReviewsSelectedRewriteAndProtectsConcurrentEdits(t *testing.T) {
	a := chatApp(t)
	a.textEngine = &fakeChatEngine{chat: func(context.Context, []textmodel.Message, func(string)) (string, error) {
		return "The deadline is Monday. [[1]]", nil
	}}
	_, err := a.SendChatMessage("rewrite", "chat", ChatRequest{Message: "Change Friday to Monday", Source: "transcript", Selection: "The deadline is Friday."})
	if err != nil {
		t.Fatal(err)
	}
	output, err := a.SaveChatReply("chat", "rewrite")
	if err != nil || output.Text != "The deadline is Monday. [[1]]" || output.Citations == nil || len(output.Citations.References) != 1 {
		t.Fatal(output, err)
	}
	if _, err := a.RegenerateSessionOutput("regenerate", "chat", output.ID); err == nil {
		t.Fatal("chat output regenerated with a non-replayable prompt")
	}
	before := "The deadline is Friday.\nAlex owns the launch."
	if err := a.ApplyChatReply("chat", "rewrite", before); err != nil {
		t.Fatal(err)
	}
	entry, _ := a.store.Session("chat")
	if entry.FinalTranscript != "The deadline is Monday.\nAlex owns the launch." || entry.RawTranscript != before {
		t.Fatal("selected rewrite lost surrounding/original text", entry)
	}
	if err := a.ApplyChatReply("chat", "rewrite", before); err == nil {
		t.Fatal("stale review overwrote new text")
	}
	if err := a.SaveTranscript("chat", before+"\nThe deadline is Friday."); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyChatReply("chat", "rewrite", before+"\nThe deadline is Friday."); err == nil {
		t.Fatal("ambiguous passage replaced")
	}
}

func TestChatRetryDoesNotBroadenChangedSelection(t *testing.T) {
	a := chatApp(t)
	calls := 0
	a.textEngine = &fakeChatEngine{chat: func(context.Context, []textmodel.Message, func(string)) (string, error) {
		calls++
		return "", errors.New("offline")
	}}
	if _, err := a.SendChatMessage("selected", "chat", ChatRequest{Message: "Rewrite this", Source: "transcript", Selection: "The deadline is Friday."}); err != nil {
		t.Fatal(err)
	}
	if err := a.SaveTranscript("chat", "The deadline is Monday."); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SendChatMessage("retry-selected", "chat", ChatRequest{Retry: true}); err == nil {
		t.Fatal("stale selection silently dropped")
	}
	chat, _ := a.GetSessionChat("chat")
	if calls != 1 || chat.Messages[0].Selection != "The deadline is Friday." || chat.Messages[1].ID != "selected" {
		t.Fatal("retry changed original question", chat, calls)
	}
}

func TestChatCompactionKeepsVisibleHistoryAndRecentDraft(t *testing.T) {
	a := chatApp(t)
	summaries, replies := 0, 0
	a.textEngine = &fakeChatEngine{chat: func(_ context.Context, m []textmodel.Message, emit func(string)) (string, error) {
		if emit == nil {
			summaries++
			if !strings.Contains(m[0].Content, "source version") {
				t.Error("compaction lost source-version instruction")
			}
			return "User wants a concise launch email. Earlier source facts may be outdated.", nil
		}
		replies++
		if summaries > 0 {
			for _, msg := range m {
				if strings.Contains(msg.Content, "Draft 1 ") {
					t.Error("compacted older reply still sent in full")
				}
			}
		}
		return strings.Repeat(fmt.Sprintf("Draft %d ", replies), 600), nil
	}}
	var chat storage.Chat
	for i := 0; i < 8; i++ {
		var err error
		chat, err = a.SendChatMessage(string(rune('a'+i)), "chat", ChatRequest{Message: "Refine this draft", Source: "transcript"})
		if err != nil {
			t.Fatal(err)
		}
	}
	if summaries == 0 || chat.CompactedThrough == 0 || chat.Summary == "" || len(chat.Messages) != 16 {
		t.Fatal("compaction removed visible history or did not run", chat.CompactedThrough, len(chat.Messages), summaries)
	}
}

func TestChatCompactionFailureKeepsPriorSummaryAndCanRetry(t *testing.T) {
	a := chatApp(t)
	a.textEngine = &fakeChatEngine{chat: func(_ context.Context, m []textmodel.Message, emit func(string)) (string, error) {
		if emit == nil {
			return "", errors.New("offline")
		}
		return strings.Repeat("Draft ", 800), nil
	}}
	for _, id := range []string{"a", "b", "c", "d"} {
		if _, err := a.SendChatMessage(id, "chat", ChatRequest{Message: "Refine", Source: "transcript"}); err != nil {
			t.Fatal(err)
		}
	}
	chat, _ := a.GetSessionChat("chat")
	if chat.Messages[len(chat.Messages)-1].State != "failed" || chat.CompactedThrough != 0 || len(chat.Messages) != 8 {
		t.Fatal("compaction failure lost the turn", chat)
	}
}

func TestChatDeletionDuringReplyDoesNotRecreateConversation(t *testing.T) {
	a := chatApp(t)
	started, release := make(chan struct{}), make(chan struct{})
	a.textEngine = &fakeChatEngine{chat: func(context.Context, []textmodel.Message, func(string)) (string, error) {
		close(started)
		<-release
		return "Done", nil
	}}
	done := make(chan error, 1)
	go func() {
		_, err := a.SendChatMessage("delete", "chat", ChatRequest{Message: "Draft", Source: "transcript"})
		done <- err
	}()
	<-started
	if err := a.store.TrashSessions([]string{"chat"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err == nil {
		t.Fatal("saved a deleted conversation")
	}
	if _, err := a.store.Chat("chat"); err == nil {
		t.Fatal("deleted chat accessible")
	}
}

func TestChatRecoversInterruptedTurnAndHonorsEarlyCancellation(t *testing.T) {
	a := chatApp(t)
	a.textEngine = &fakeChatEngine{chat: func(context.Context, []textmodel.Message, func(string)) (string, error) {
		t.Error("cancelled request reached model")
		return "", nil
	}}
	a.CancelTextProcessing("early")
	if _, err := a.SendChatMessage("early", "chat", ChatRequest{Message: "Draft", Source: "transcript"}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	chat, _ := a.store.Chat("chat")
	if len(chat.Messages) != 0 {
		t.Fatal("early cancellation persisted a turn")
	}
	source := storage.NewChatSource("transcript", "The deadline is Friday.")
	chat.Sources = []storage.ChatSource{source}
	for i, role := range []string{"user", "assistant"} {
		state := "complete"
		if i == 1 {
			state = "pending"
		}
		chat.Messages = append(chat.Messages, storage.ChatMessage{ID: role, Role: role, Content: "Interrupted", State: state, SourceID: source.ID, CreatedAt: time.Now().Format(time.RFC3339Nano)})
	}
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}
	chat, err := a.GetSessionChat("chat")
	if err != nil || chat.Messages[1].State != "failed" {
		t.Fatal(chat, err)
	}
}
