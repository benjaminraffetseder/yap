package conversations

import (
	"context"
	"strings"
	"testing"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

type engineFunc func(context.Context, []textmodel.Message, func(string)) (string, error)

func (f engineFunc) Chat(ctx context.Context, _ textmodel.Config, messages []textmodel.Message, emit func(string)) (string, error) {
	return f(ctx, messages, emit)
}

func conversationStore(t *testing.T) (*storage.Store, textmodel.Config) {
	t.Helper()
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	entry := storage.NewSession("conversation", 1000, "First paragraph.\nSecond paragraph.", "tiny", "en", "")
	if err := store.Add(entry); err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "test-model"
	return store, config
}

func TestStoppedTurnPersistsPartialReplyAndRejectsStaleRetry(t *testing.T) {
	store, config := conversationStore(t)
	turn, err := Prepare(store, config, "first", "conversation", Request{
		Source: "transcript", Message: "Rewrite this passage", Selection: "First paragraph.",
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	engine := engineFunc(func(_ context.Context, messages []textmodel.Message, emit func(string)) (string, error) {
		if !strings.Contains(messages[len(messages)-1].Content, "Selected source passage:\nFirst paragraph.") {
			t.Fatal("selection was not supplied to inference")
		}
		emit("Partial rewrite")
		cancel()
		return "Partial rewrite", context.Canceled
	})
	result, runErr := turn.Run(ctx, engine, func(string, bool) {})
	chat, err := turn.Complete(ctx, result, runErr)
	if err != nil {
		t.Fatal(err)
	}
	last := chat.Messages[len(chat.Messages)-1]
	if last.State != "cancelled" || last.Content != "Partial rewrite" || last.Error != "Reply stopped." {
		t.Fatalf("stopped turn was lost: %+v", last)
	}
	if err := store.UpdateTranscript("conversation", "A replacement source."); err != nil {
		t.Fatal(err)
	}
	if _, err := Prepare(store, config, "retry", "conversation", Request{Retry: true}); err == nil {
		t.Fatal("retry silently broadened a stale selection to the replacement source")
	}
	saved, err := store.Chat("conversation")
	if err != nil || len(saved.Messages) != 2 || saved.Messages[1].State != "cancelled" {
		t.Fatalf("rejected retry changed the saved conversation: %+v, %v", saved, err)
	}
}

func TestRecoveryLeavesActivePendingTurnOwnedByItsCaller(t *testing.T) {
	store, config := conversationStore(t)
	if _, err := Prepare(store, config, "active", "conversation", Request{Source: "transcript", Message: "Summarize"}); err != nil {
		t.Fatal(err)
	}
	chat, err := Load(store, "conversation", "active")
	if err != nil || chat.Messages[1].State != "pending" {
		t.Fatalf("recovery interrupted the active request: %+v, %v", chat, err)
	}
	chat, err = Load(store, "conversation", "")
	if err != nil || chat.Messages[1].State != "failed" {
		t.Fatalf("orphaned request was not recovered: %+v, %v", chat, err)
	}
}
