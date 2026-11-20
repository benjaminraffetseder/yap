package textprocessing

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"testing"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

type requestSource struct {
	session storage.Session
	output  storage.GeneratedOutput
	err     error
	lookups []string
}

func (s *requestSource) Session(id string) (storage.Session, error) {
	s.lookups = append(s.lookups, "session:"+id)
	return s.session, s.err
}

func (s *requestSource) GeneratedOutput(sessionID, outputID string) (storage.GeneratedOutput, error) {
	s.lookups = append(s.lookups, "output:"+sessionID+":"+outputID)
	return s.output, s.err
}

func TestPreparationRegeneratesSavedInputAndPromptWithoutReselectingRecipe(t *testing.T) {
	config, _ := recipeConfig()
	source := &requestSource{
		session: storage.Session{ID: "session", FinalTranscript: "Recently edited speech"},
		output:  storage.GeneratedOutput{Input: "Saved input snapshot", Prompt: textmodel.Prompt{ID: "removed-prompt", Name: "Old prompt", Instruction: "Original instructions"}},
	}
	prepared, err := Prepare(config, Request{Target: &OutputTarget{SessionID: "session", OutputID: "output"}}, source)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Input != source.output.Input || prepared.Prompt != source.output.Prompt || prepared.Recipe != nil || prepared.Session.ID != "session" {
		t.Fatal("regeneration lost saved source", prepared)
	}
	if !reflect.DeepEqual(source.lookups, []string{"session:session", "output:session:output"}) {
		t.Fatal("source lookup order changed", source.lookups)
	}
	source.output.Prompt.ID = "chat"
	if _, err := Prepare(config, Request{Target: &OutputTarget{SessionID: "session", OutputID: "output"}}, source); err == nil || err.Error() != "continue in chat to refine a saved chat output" {
		t.Fatal("saved chat output was routed through prompt generation", err)
	}
}

func TestPreparationDefersChainInputValidationUntilItsSelectedStep(t *testing.T) {
	config, recipe := recipeConfig()
	config.Chains = []textmodel.Chain{recipe}
	source := &requestSource{session: storage.Session{ID: "session", RawTranscript: "Original speech"}}
	prepared, err := Prepare(config, Request{Target: &OutputTarget{SessionID: "session"}, PromptID: recipe.ID}, source)
	if err != nil || prepared.Recipe == nil || prepared.Recipe.ID != recipe.ID {
		t.Fatal("empty edited transcript blocked a recipe using original speech", prepared, err)
	}
}

func TestPreparationKeepsValidationAndMissingSourceErrorOrder(t *testing.T) {
	config, _ := recipeConfig()
	source := &requestSource{err: sql.ErrNoRows}
	disabled := config
	disabled.Enabled = false
	if _, err := Prepare(disabled, Request{TitleSessionID: "missing"}, source); err == nil || err.Error() != "enable a local text model in Prompts first" || len(source.lookups) != 0 {
		t.Fatal("looked up source before validating settings", err, source.lookups)
	}
	if _, err := Prepare(config, Request{TitleSessionID: "missing"}, source); err == nil || err.Error() != "this dictation no longer exists" {
		t.Fatal("missing source error changed", err)
	}
	source.err = errors.New("read failed")
	if _, err := Prepare(config, Request{TitleSessionID: "unreadable"}, source); err != source.err {
		t.Fatal("storage failure was replaced", err)
	}
	if _, err := Prepare(config, Request{Input: " ", Refinement: &PromptRefinement{Endpoint: "https://example.com"}}, source); err == nil || err.Error() != "instructions must contain between 1 and 8,000 characters without null bytes" {
		t.Fatal("connection validation took precedence over draft validation", err)
	}
}

type refinementEngine struct{ t *testing.T }

func (e refinementEngine) Process(context.Context, textmodel.Config, textmodel.Prompt, string) (string, error) {
	e.t.Fatal("refinement used transformation route")
	return "", nil
}

func (e refinementEngine) Refine(_ context.Context, config textmodel.Config, input string) (string, error) {
	if config.Provider != "builtin" || config.Model != "gemma-4-e2b" || config.ContextLength != 32768 || input != "Draft instruction" {
		e.t.Fatal("refinement lost its draft connection", config, input)
	}
	return "Refined instruction", nil
}

func TestPreparedRefinementRunsWithCompleteDraftConnection(t *testing.T) {
	draft := textmodel.Config{Enabled: true, Provider: "builtin", Model: "gemma-4-e2b", ContextLength: 32768}
	prepared, err := Prepare(textmodel.Config{}, Request{Config: &draft, Input: "Draft instruction", Refinement: &PromptRefinement{}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, stats, err := prepared.Run(context.Background(), refinementEngine{t}, nil, RecipeHooks{})
	if err != nil || result != "Refined instruction" || stats != nil {
		t.Fatal(result, stats, err)
	}
}
