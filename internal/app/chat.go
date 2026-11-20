package app

import (
	"context"
	"errors"
	"time"

	"yap/internal/app/conversations"
	"yap/internal/storage"
)

type ChatRequest struct {
	Message   string `json:"message"`
	Source    string `json:"source"`
	Selection string `json:"selection"`
	OutputID  string `json:"outputId"`
	Retry     bool   `json:"retry"`
}

type ChatProgress struct {
	SessionID  string `json:"sessionId"`
	RequestID  string `json:"requestId"`
	Content    string `json:"content"`
	Compacting bool   `json:"compacting"`
}

func (a *App) GetSessionChat(sessionID string) (storage.Chat, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return storage.Chat{}, err
	}
	return conversations.Load(a.store, sessionID, a.textJobID)
}

func (a *App) ClearSessionChat(sessionID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	if a.textJobID != "" {
		return errors.New("finish or stop the current reply before clearing chat")
	}
	return a.store.ClearChat(sessionID)
}

func (a *App) SendChatMessage(requestID, sessionID string, request ChatRequest) (storage.Chat, error) {
	a.mu.Lock()
	fail := func(err error) (storage.Chat, error) { a.mu.Unlock(); return storage.Chat{}, err }
	if err := a.historyAvailableLocked(); err != nil {
		return fail(err)
	}
	if !validTextRequestID(requestID) {
		return fail(errors.New("invalid chat request"))
	}
	if a.textRequestCancelledLocked(requestID) {
		return fail(context.Canceled)
	}
	if a.busyLocked() || a.textJobID != "" {
		return fail(errors.New("finish the current operation before chatting"))
	}
	engine, ok := a.textEngine.(conversations.Engine)
	if !ok {
		return fail(errors.New("the text engine does not support chat"))
	}
	turn, err := conversations.Prepare(a.store, a.textConfig, requestID, sessionID, conversations.Request(request))
	if err != nil {
		return fail(err)
	}
	ctx, cancel, previous, savedText := a.beginTextJobLocked(requestID)
	a.mu.Unlock()
	defer a.wg.Done()
	defer cancel()
	lastProgress := time.Time{}
	progress := func(content string, compacting bool) {
		if content != "" && time.Since(lastProgress) < 40*time.Millisecond {
			return
		}
		lastProgress = time.Now()
		a.mu.Lock()
		defer a.mu.Unlock()
		if !a.closing && ctx.Err() == nil {
			a.event("chat:progress", ChatProgress{sessionID, requestID, content, compacting})
		}
	}
	result, runErr := turn.Run(ctx, engine, progress)
	a.mu.Lock()
	defer a.mu.Unlock()
	defer a.finishTextJobLocked(previous, savedText)
	chat, err := turn.Complete(ctx, result, runErr)
	if err != nil {
		return chat, err
	}
	a.event("chat:changed", sessionID)
	return chat, nil
}

func (a *App) SaveChatReply(sessionID, messageID string) (storage.GeneratedOutput, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return storage.GeneratedOutput{}, err
	}
	output, err := conversations.SaveReply(a.store, sessionID, messageID)
	if err == nil {
		a.event("dictation:history")
	}
	return output, err
}

func (a *App) ApplyChatReply(sessionID, messageID, expectedTranscript string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	replacement, err := conversations.Replacement(a.store, sessionID, messageID, expectedTranscript)
	if err != nil {
		return err
	}
	return a.saveTranscriptLocked(sessionID, replacement)
}
