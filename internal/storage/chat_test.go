package storage

import (
	"context"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	textmodel "yap/internal/inference/text"
)

func TestChatPersistsSourcesBacksUpAndFollowsDeletion(t *testing.T) {
	s := backupStore(t)
	entry := NewSession("chat", 1000, "Hello café 👋.\nDeadline Friday.", "tiny", "en", "")
	if err := s.Add(entry); err != nil {
		t.Fatal(err)
	}
	source := NewChatSource("transcript", entry.FinalTranscript)
	chat := Chat{SessionID: entry.ID, Sources: []ChatSource{source}, Messages: []ChatMessage{}}
	for _, role := range []string{"user", "assistant"} {
		chat.Messages = append(chat.Messages, ChatMessage{ID: role, Role: role, Content: "Friday [[2]]", SourceID: source.ID, State: "complete", CreatedAt: time.Now().Format(time.RFC3339Nano), References: ChatReferences("Friday [[2]]", source.Text)})
	}
	if err := s.SaveChat(chat); err != nil {
		t.Fatal(err)
	}
	got, err := s.Chat(entry.ID)
	if err != nil || !reflect.DeepEqual(got, chat) {
		t.Fatal(got, err)
	}
	path := filepath.Join(t.TempDir(), "backup.zip")
	if _, err := s.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	if _, err := dest.RestoreBackup(context.Background(), archive, false); err != nil {
		t.Fatal(err)
	}
	restored, err := dest.Chat(entry.ID)
	if err != nil || !reflect.DeepEqual(restored, chat) {
		t.Fatal("chat omitted from backup", restored, err)
	}
	if err := s.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveChat(chat); err == nil {
		t.Fatal("chat recreated after deletion")
	}
	if err := s.RestoreSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if restored, err := s.Chat(entry.ID); err != nil || len(restored.Messages) != 2 {
		t.Fatal("undo lost chat", restored, err)
	}
	if err := s.TrashSessions([]string{entry.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PermanentlyDeleteSessions([]string{entry.ID}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM recording_chats").Scan(&count); err != nil || count != 0 {
		t.Fatal("permanent deletion left private chat", count, err)
	}
}

func TestChatReferencesOnlyAcceptExistingNumberedPassages(t *testing.T) {
	text := "Hello café 👋.\nDeadline Friday.\n" + strings.Repeat("long ", 300)
	refs := ChatReferences("See [[2]], [[9999]], [[0]], [[2]] and [[1]].", text)
	if len(refs) != 2 || refs[0].Quote != "Deadline Friday." || refs[1].Quote != "Hello café 👋." {
		t.Fatal(refs)
	}
	for _, p := range ChatPassages(text) {
		if !strings.Contains(text, p) || len([]rune(p)) > 600 {
			t.Fatal("passage not an exact Unicode span")
		}
	}
}

func TestGroupedChatCitationsAndLegacyOutputRecovery(t *testing.T) {
	text := "First passage.\nSecond passage.\nThird passage."
	refs := ChatReferences("Grouped [[1], [3]], compact [[2, 3]], repeated [[1]].", text)
	if len(refs) != 3 || refs[0].Number != 1 || refs[1].Number != 3 || refs[2].Number != 2 {
		t.Fatal(refs)
	}
	if ChatReplyText("Answer [[1], [3]].") != "Answer." {
		t.Fatal("grouped citations were not removed for copying")
	}
	s := backupStore(t)
	if err := s.Add(NewSession("legacy", 1000, text, "tiny", "en", "")); err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "local"
	output := NewGeneratedOutput("legacy", text, "Answer [[1], [3]].", config, textmodel.Prompt{ID: "chat", Name: "Chat", Instruction: "Saved reply"})
	if err := s.AddGeneratedOutput(output); err != nil {
		t.Fatal(err)
	}
	got, err := s.GeneratedOutput("legacy", output.ID)
	if err != nil || got.Citations == nil || len(got.Citations.References) != 2 {
		t.Fatal("legacy output citations lost", got, err)
	}
	path := filepath.Join(t.TempDir(), "citations.zip")
	if _, err := s.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	if _, err := dest.RestoreBackup(context.Background(), archive, false); err != nil {
		t.Fatal(err)
	}
	restored, err := dest.GeneratedOutput("legacy", output.ID)
	if err != nil || !reflect.DeepEqual(restored.Citations, got.Citations) {
		t.Fatal("backup lost citation anchors", restored, err)
	}
}
