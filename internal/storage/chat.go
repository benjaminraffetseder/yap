package storage

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type ChatSource struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type ChatReference struct {
	Number int    `json:"number"`
	Quote  string `json:"quote"`
}

type ChatMessage struct {
	ID         string          `json:"id"`
	Role       string          `json:"role"`
	Content    string          `json:"content"`
	SourceID   string          `json:"sourceId"`
	Selection  string          `json:"selection,omitempty"`
	OutputID   string          `json:"outputId,omitempty"`
	OutputText string          `json:"outputText,omitempty"`
	CreatedAt  string          `json:"createdAt"`
	State      string          `json:"state"`
	Error      string          `json:"error,omitempty"`
	Model      string          `json:"model,omitempty"`
	Endpoint   string          `json:"endpoint,omitempty"`
	References []ChatReference `json:"references"`
}

type Chat struct {
	SessionID        string        `json:"sessionId"`
	Messages         []ChatMessage `json:"messages"`
	Sources          []ChatSource  `json:"sources"`
	Summary          string        `json:"summary"`
	CompactedThrough int           `json:"compactedThrough"`
}

func NewChatSource(kind, text string) ChatSource {
	return ChatSource{ID: fmt.Sprintf("%x", sha256.Sum256([]byte(kind+"\x00"+text))), Kind: kind, Text: text}
}

func (c Chat) Source(id string) ChatSource {
	for _, source := range c.Sources {
		if source.ID == id {
			return source
		}
	}
	return ChatSource{}
}

// Passages preserve exact source text, including punctuation and Unicode. Short
// numbered spans let models cite text without inventing offsets or quotations.
func ChatPassages(text string) []string {
	var passages []string
	for _, line := range strings.Split(text, "\n") {
		runes := []rune(strings.TrimSpace(line))
		for len(runes) > 0 {
			n := min(len(runes), 600)
			if n < len(runes) {
				for i := n; i > n/2; i-- {
					if runes[i-1] == ' ' {
						n = i
						break
					}
				}
			}
			passages = append(passages, string(runes[:n]))
			runes = runes[n:]
		}
	}
	return passages
}

var chatCitation = regexp.MustCompile(`\[\[\d{1,5}(?:(?:\]\s*,\s*\[|,\s*)\d{1,5})*\]\]`)
var chatCitationNumber = regexp.MustCompile(`\d{1,5}`)
var chatCitationWithSpace = regexp.MustCompile(`[ \t]*` + chatCitation.String())

func ChatReplyText(content string) string {
	return strings.TrimSpace(chatCitationWithSpace.ReplaceAllString(content, ""))
}

func ChatReferences(content, source string) []ChatReference {
	passages, seen := ChatPassages(source), map[int]bool{}
	refs := []ChatReference{}
	for _, match := range chatCitation.FindAllString(content, -1) {
		for _, number := range chatCitationNumber.FindAllString(match, -1) {
			var n int
			fmt.Sscanf(number, "%d", &n)
			if n > 0 && n <= len(passages) && !seen[n] {
				refs = append(refs, ChatReference{Number: n, Quote: passages[n-1]})
				seen[n] = true
			}
		}
	}
	return refs
}

func (s *Store) Chat(sessionID string) (Chat, error) {
	if _, err := s.Session(sessionID); err != nil {
		return Chat{}, err
	}
	out := Chat{SessionID: sessionID, Messages: []ChatMessage{}, Sources: []ChatSource{}}
	var data string
	err := s.db.QueryRow("SELECT value FROM recording_chats WHERE recording_id=?", sessionID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal([]byte(data), &out)
	if err == nil {
		for i := range out.Messages {
			msg := &out.Messages[i]
			if msg.Role == "assistant" {
				msg.References = ChatReferences(msg.Content, out.Source(msg.SourceID).Text)
			}
		}
	}
	return out, err
}

func validateChat(chat Chat) error {
	if !validBackupID(chat.SessionID) || len(chat.Messages) > 2000 || len(chat.Sources) > 1000 || chat.CompactedThrough < 0 || chat.CompactedThrough > len(chat.Messages) || !validBackupString(chat.Summary, 6000) {
		return errors.New("invalid or oversized conversation")
	}
	sources := map[string]ChatSource{}
	passagesBySource := map[string][]string{}
	for _, source := range chat.Sources {
		if (source.Kind != "transcript" && source.Kind != "original") || !validBackupString(source.Text, 100000) || source.Text == "" || NewChatSource(source.Kind, source.Text).ID != source.ID || sources[source.ID].ID != "" {
			return errors.New("invalid chat source")
		}
		sources[source.ID] = source
		passagesBySource[source.ID] = ChatPassages(source.Text)
	}
	ids := map[string]bool{}
	for i, msg := range chat.Messages {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		if !validBackupID(msg.ID) || ids[msg.ID] || msg.Role != role || sources[msg.SourceID].ID == "" || !validBackupString(msg.Content, 100000) || !validBackupString(msg.Selection, 100000) || !validBackupString(msg.OutputText, 100000) || !validBackupString(msg.Error, 2000) {
			return errors.New("invalid chat message")
		}
		if _, err := time.Parse(time.RFC3339Nano, msg.CreatedAt); err != nil {
			return errors.New("invalid chat message date")
		}
		if msg.State != "complete" && msg.State != "pending" && msg.State != "failed" && msg.State != "cancelled" {
			return errors.New("invalid chat message state")
		}
		if msg.Selection != "" && !strings.Contains(sources[msg.SourceID].Text, msg.Selection) {
			return errors.New("chat selection no longer matches its source")
		}
		if msg.Role == "assistant" && (msg.SourceID != chat.Messages[i-1].SourceID || (msg.State == "pending" && i != len(chat.Messages)-1)) {
			return errors.New("invalid chat turn")
		}
		for _, ref := range msg.References {
			passages := passagesBySource[msg.SourceID]
			if ref.Number < 1 || ref.Number > len(passages) || ref.Quote != passages[ref.Number-1] {
				return errors.New("invalid chat reference")
			}
		}
		ids[msg.ID] = true
	}
	if len(chat.Messages)%2 != 0 {
		return errors.New("invalid chat turn")
	}
	return nil
}

func (s *Store) SaveChat(chat Chat) error {
	if err := validateChat(chat); err != nil {
		return err
	}
	data, err := json.Marshal(chat)
	if err != nil {
		return err
	}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return errors.New("conversation is too large; clear chat to start again")
	}
	result, err := s.db.Exec(`INSERT INTO recording_chats(recording_id,value) SELECT id,? FROM recordings WHERE id=? AND NOT EXISTS (SELECT 1 FROM deleted_recordings d WHERE d.id=recordings.id) ON CONFLICT(recording_id) DO UPDATE SET value=excluded.value`, string(data), chat.SessionID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return errors.New("this dictation no longer exists; the conversation was not saved")
	}
	return err
}

func (s *Store) ClearChat(sessionID string) error {
	_, err := s.db.Exec("DELETE FROM recording_chats WHERE recording_id=?", sessionID)
	return err
}
