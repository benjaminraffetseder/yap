package app

import (
	"context"
	"errors"

	"yap/internal/app/textprocessing"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func (a *App) SaveTextProcessing(config textmodel.Config) (textmodel.Config, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.availableLocked(); err != nil {
		return textmodel.Config{}, err
	}
	if a.busyLocked() || a.textJobID != "" {
		return textmodel.Config{}, errors.New("finish the current operation before changing prompts or the text model")
	}
	normalized, err := textmodel.Normalize(config)
	if err != nil {
		return textmodel.Config{}, err
	}
	if err = a.store.SaveTextProcessing(normalized); err != nil {
		return textmodel.Config{}, err
	}
	connectionChanged := textprocessing.ConnectionChanged(a.textConfig, normalized)
	a.textConfig = normalized
	if connectionChanged {
		if engine, ok := a.textEngine.(interface{ Release() }); ok {
			engine.Release()
		}
	}
	a.event("setup:changed", []string{"configuration"})
	return textmodel.Normalize(normalized)
}

// Manual transformations return a preview only. They do not save a recording,
// change a draft, or touch the clipboard. The frontend explicitly applies it.
func (a *App) ProcessText(requestID, input, promptID string) (string, error) {
	return a.processTextRequest(requestID, textprocessing.Request{Input: input, PromptID: promptID})
}

func (a *App) TestTextModel(requestID string) (string, error) {
	return a.processTextRequest(requestID, textprocessing.Request{Input: "Connection test.", Test: true})
}

// Queue-only title commit choices extend the feature request without mirroring it.
type textRequest struct {
	textprocessing.Request
	saveTitle     bool
	expectedTitle string
}

// Refinement uses the chosen draft connection and returns a preview. It does
// not require valid saved prompts or persist any settings or generated outputs.
func (a *App) RefinePrompt(requestID, endpoint, model, instruction string) (string, error) {
	return a.processTextRequest(requestID, textprocessing.Request{Input: instruction, Refinement: &textprocessing.PromptRefinement{Endpoint: endpoint, Model: model}})
}

// Built-in refinement uses the complete draft connection, including its context
// length, while preserving the existing external-server method contract.
func (a *App) RefinePromptWithConfig(requestID string, config textmodel.Config, instruction string) (string, error) {
	config.Enabled, config.AutoPromptID, config.Prompts, config.Chains = true, "", nil, nil
	return a.processTextRequest(requestID, textprocessing.Request{Input: instruction, Config: &config, Refinement: &textprocessing.PromptRefinement{}})
}

// GenerateSessionTitle returns a suggestion only. RenameSession explicitly saves
// it after the user has reviewed the draft; transcripts and outputs stay intact.
func (a *App) GenerateSessionTitle(requestID, sessionID string) (string, error) {
	if sessionID == "" {
		return "", errors.New("choose a saved dictation")
	}
	output, err := a.processTextRequest(requestID, textprocessing.Request{TitleSessionID: sessionID})
	if err != nil {
		return "", err
	}
	return textprocessing.NormalizeTitle(output)
}

func (a *App) GenerateSessionOutput(requestID, sessionID, promptID string) (string, error) {
	return a.processTextRequest(requestID, textprocessing.Request{PromptID: promptID, Target: &textprocessing.OutputTarget{SessionID: sessionID}})
}

func (a *App) RegenerateSessionOutput(requestID, sessionID, outputID string) (string, error) {
	if outputID == "" {
		return "", errors.New("choose a saved output")
	}
	return a.processTextRequest(requestID, textprocessing.Request{Target: &textprocessing.OutputTarget{SessionID: sessionID, OutputID: outputID}})
}

func (a *App) GetSessionOutputs(sessionID string) ([]storage.GeneratedOutput, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return nil, err
	}
	return a.store.GeneratedOutputs(sessionID)
}

func (a *App) DeleteSessionOutput(sessionID, outputID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return err
	}
	if err := a.store.DeleteGeneratedOutput(sessionID, outputID); err != nil {
		return err
	}
	a.event("dictation:history")
	return nil
}

func (a *App) processTextRequest(requestID string, request textprocessing.Request) (string, error) {
	a.mu.Lock()
	return a.processTextRequestLocked(requestID, textRequest{Request: request})
}

// The caller transfers ownership of mu; this method always returns with it
// unlocked. Queue workers claim their next job before transferring the lock,
// and inference runs without it.
func (a *App) processTextRequestLocked(requestID string, request textRequest) (string, error) {
	target := request.Target
	if err := a.availableLocked(); err != nil {
		a.mu.Unlock()
		return "", err
	}
	if !validTextRequestID(requestID) {
		a.mu.Unlock()
		return "", errors.New("invalid processing request")
	}
	if a.textRequestCancelledLocked(requestID) {
		a.mu.Unlock()
		return "", context.Canceled
	}
	if a.textJobID != "" || a.busyLocked() {
		a.mu.Unlock()
		return "", errors.New("finish the current operation before processing text")
	}
	prepared, err := textprocessing.Prepare(a.textConfig, request.Request, a.store)
	if err != nil {
		a.mu.Unlock()
		return "", err
	}
	ctx, cancel, previous, previousSavedText := a.beginTextJobLocked(requestID)
	a.mu.Unlock()
	defer a.wg.Done()
	defer cancel()
	output, stats, err := prepared.Run(ctx, a.textEngine, a.store.AddGeneratedOutput, a.textRecipeHooks(ctx))
	a.mu.Lock()
	defer a.mu.Unlock()
	a.finishTextJobLocked(previous, previousSavedText)
	if a.closing || ctx.Err() != nil {
		return "", context.Canceled
	}
	if err == nil && target != nil && prepared.Recipe == nil {
		generated := storage.NewGeneratedOutput(target.SessionID, prepared.Input, output, prepared.Config, prepared.Prompt)
		generated.Stats = stats
		err = a.store.AddGeneratedOutput(generated)
		if err == nil {
			a.event("dictation:history")
		}
	}
	if err == nil && request.saveTitle {
		output, err = textprocessing.NormalizeTitle(output)
		if err == nil {
			var entry storage.Session
			entry, err = a.store.Session(request.TitleSessionID)
			if err == nil && entry.Title != request.expectedTitle {
				err = errors.New("the title changed while generation was running; the new title was kept")
			}
			if err == nil {
				err = a.store.SaveSessionTitle(entry.ID, output)
				if err == nil {
					a.event("dictation:history")
				}
			}
		}
	}
	return output, err
}
