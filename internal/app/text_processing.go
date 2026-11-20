package app

import (
	"context"
	"errors"
	"strings"
	"time"

	"yap/internal/app/textprocessing"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func (a *App) SaveTextProcessing(config textmodel.Config) (textmodel.Config, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return textmodel.Config{}, err
	}
	if a.busy() || a.textJobID != "" {
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
	return a.processTextRequest(requestID, textRequest{input: input, promptID: promptID})
}

func (a *App) TestTextModel(requestID string) (string, error) {
	return a.processTextRequest(requestID, textRequest{input: "Connection test.", test: true})
}

type outputTarget struct{ sessionID, outputID string }
type promptRefinement struct{ endpoint, model string }
type textRequest struct {
	config          *textmodel.Config
	saveTitle       bool
	expectedTitle   string
	input, promptID string
	titleSessionID  string
	test            bool
	target          *outputTarget
	refinement      *promptRefinement
}

// Refinement uses the chosen draft connection and returns a preview. It does
// not require valid saved prompts or persist any settings or generated outputs.
func (a *App) RefinePrompt(requestID, endpoint, model, instruction string) (string, error) {
	return a.processTextRequest(requestID, textRequest{input: instruction, refinement: &promptRefinement{endpoint: endpoint, model: model}})
}

// Built-in refinement uses the complete draft connection, including its context
// length, while preserving the existing external-server method contract.
func (a *App) RefinePromptWithConfig(requestID string, config textmodel.Config, instruction string) (string, error) {
	config.Enabled, config.AutoPromptID, config.Prompts, config.Chains = true, "", nil, nil
	return a.processTextRequest(requestID, textRequest{input: instruction, config: &config, refinement: &promptRefinement{}})
}

// GenerateSessionTitle returns a suggestion only. RenameSession explicitly saves
// it after the user has reviewed the draft; transcripts and outputs stay intact.
func (a *App) GenerateSessionTitle(requestID, sessionID string) (string, error) {
	if sessionID == "" {
		return "", errors.New("choose a saved dictation")
	}
	output, err := a.processTextRequest(requestID, textRequest{titleSessionID: sessionID})
	if err != nil {
		return "", err
	}
	return normalizeSessionTitle(output)
}

func normalizeSessionTitle(output string) (string, error) {
	return textprocessing.NormalizeTitle(output)
}

func (a *App) GenerateSessionOutput(requestID, sessionID, promptID string) (string, error) {
	return a.processTextRequest(requestID, textRequest{promptID: promptID, target: &outputTarget{sessionID: sessionID}})
}

func (a *App) RegenerateSessionOutput(requestID, sessionID, outputID string) (string, error) {
	if outputID == "" {
		return "", errors.New("choose a saved output")
	}
	return a.processTextRequest(requestID, textRequest{target: &outputTarget{sessionID: sessionID, outputID: outputID}})
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

// Use the draft endpoint without saving preferences or changing dictation state.
func (a *App) ListTextModels(requestID, endpoint string) ([]string, error) {
	a.mu.Lock()
	if err := a.available(); err != nil {
		a.mu.Unlock()
		return nil, err
	}
	if requestID == "" || len(requestID) > 80 || strings.ContainsAny(requestID, "\r\n\x00") {
		a.mu.Unlock()
		return nil, errors.New("invalid discovery request")
	}
	a.pruneTextCancellationsLocked()
	if _, cancelled := a.cancelledTextRequests[requestID]; cancelled {
		a.mu.Unlock()
		return nil, context.Canceled
	}
	if len(a.modelDiscoveryCancels) >= 4 || a.modelDiscoveryCancels[requestID] != nil || a.textJobID == requestID {
		a.mu.Unlock()
		return nil, errors.New("model discovery is already running; try again shortly")
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	if a.modelDiscoveryCancels == nil {
		a.modelDiscoveryCancels = map[string]context.CancelFunc{}
	}
	a.modelDiscoveryCancels[requestID] = cancel
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer cancel()
	models, err := textmodel.ListModels(ctx, endpoint)
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.modelDiscoveryCancels, requestID)
	if a.closing || ctx.Err() != nil {
		return nil, context.Canceled
	}
	return models, err
}

func (a *App) processTextRequest(requestID string, request textRequest) (string, error) {
	a.mu.Lock()
	return a.processTextRequestLocked(requestID, request)
}

// Takes ownership of a.mu and releases it while inference runs. Queue workers
// claim their next job and start processing under the same lock.
func (a *App) processTextRequestLocked(requestID string, request textRequest) (string, error) {
	target := request.target
	if err := a.available(); err != nil {
		a.mu.Unlock()
		return "", err
	}
	if requestID == "" || len(requestID) > 80 || strings.ContainsAny(requestID, "\r\n\x00") {
		a.mu.Unlock()
		return "", errors.New("invalid processing request")
	}
	a.pruneTextCancellationsLocked()
	if _, cancelled := a.cancelledTextRequests[requestID]; cancelled {
		a.mu.Unlock()
		return "", context.Canceled
	}
	if a.textJobID != "" || a.busy() {
		a.mu.Unlock()
		return "", errors.New("finish the current operation before processing text")
	}
	featureRequest := textprocessing.Request{Config: request.config, Input: request.input, PromptID: request.promptID, TitleSessionID: request.titleSessionID, Test: request.test}
	if target != nil {
		featureRequest.Target = &textprocessing.OutputTarget{SessionID: target.sessionID, OutputID: target.outputID}
	}
	if request.refinement != nil {
		featureRequest.Refinement = &textprocessing.PromptRefinement{Endpoint: request.refinement.endpoint, Model: request.refinement.model}
	}
	prepared, err := textprocessing.Prepare(a.textConfig, featureRequest, a.store)
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
		generated := storage.NewGeneratedOutput(target.sessionID, prepared.Input, output, prepared.Config, prepared.Prompt)
		generated.Stats = stats
		err = a.store.AddGeneratedOutput(generated)
		if err == nil {
			a.event("dictation:history")
		}
	}
	if err == nil && request.saveTitle {
		output, err = normalizeSessionTitle(output)
		if err == nil {
			var entry storage.Session
			entry, err = a.store.Session(request.titleSessionID)
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

func (a *App) beginTextJobLocked(requestID string) (context.Context, context.CancelFunc, Status, string) {
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	a.textJobID, a.textCancel = requestID, cancel
	previous, savedText := a.status, ""
	if previous.Phase == "done" && a.id != "" {
		if entry, err := a.store.Session(a.id); err == nil {
			savedText = entry.FinalTranscript
		}
	}
	a.status.Phase, a.status.Message = "text-processing", "Processing text…"
	a.wg.Add(1)
	a.emit()
	return ctx, cancel, previous, savedText
}

func (a *App) finishTextJobLocked(previous Status, savedText string) {
	a.textJobID, a.textCancel = "", nil
	a.status.Phase, a.status.Message, a.status.Transcript = previous.Phase, previous.Message, previous.Transcript
	if previous.Phase == "done" && a.id != "" && !a.closing {
		if entry, err := a.store.Session(a.id); err == nil {
			if entry.FinalTranscript != savedText {
				a.status.Transcript, a.status.Message = entry.FinalTranscript, "Transcript updated in History"
			}
		} else {
			a.status.Phase, a.status.Message, a.status.Transcript = "idle", "Ready", ""
		}
	}
	a.emit()
}

func (a *App) CancelTextProcessing(requestID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if requestID == "" || len(requestID) > 80 {
		return
	}
	// Remember an early cancellation if the bridge schedules it before the
	// processing call. A stale cancellation never cancels a different job.
	a.pruneTextCancellationsLocked()
	if a.cancelledTextRequests == nil {
		a.cancelledTextRequests = map[string]time.Time{}
	}
	if len(a.cancelledTextRequests) >= 128 {
		var oldest string
		for id, when := range a.cancelledTextRequests {
			if oldest == "" || when.Before(a.cancelledTextRequests[oldest]) {
				oldest = id
			}
		}
		delete(a.cancelledTextRequests, oldest)
	}
	a.cancelledTextRequests[requestID] = time.Now()
	if a.textJobID == requestID && a.textCancel != nil {
		a.textCancel()
	}
	if cancel := a.modelDiscoveryCancels[requestID]; cancel != nil {
		cancel()
	}
}

func (a *App) pruneTextCancellationsLocked() {
	cutoff := time.Now().Add(-10 * time.Minute)
	for id, when := range a.cancelledTextRequests {
		if when.Before(cutoff) {
			delete(a.cancelledTextRequests, id)
		}
	}
}
