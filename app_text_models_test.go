package main

import (
	"reflect"
	"testing"
	textmodel "yap/internal/inference/text"
)

type releasingTextEngine struct {
	*fakeTextEngine
	releases int
}

func (e *releasingTextEngine) Release() { e.releases++ }

func TestTextModelReloadsForContextButNotPromptEdits(t *testing.T) {
	a := testApp(t)
	engine := &releasingTextEngine{fakeTextEngine: &fakeTextEngine{}}
	a.textEngine = engine
	c := textmodel.Defaults()
	c.Provider, c.Model, c.Enabled, c.ContextLength = "builtin", "gemma-4-e2b", true, 8192
	if _, err := a.SaveTextProcessing(c); err != nil {
		t.Fatal(err)
	}
	c.Prompts[0].Instruction = "Preserve all names."
	if _, err := a.SaveTextProcessing(c); err != nil {
		t.Fatal(err)
	}
	if engine.releases != 1 {
		t.Fatal("prompt edit unnecessarily unloaded the model")
	}
	c.ContextLength = 16384
	if _, err := a.SaveTextProcessing(c); err != nil {
		t.Fatal(err)
	}
	if engine.releases != 2 {
		t.Fatal("context edit did not unload the previous worker")
	}
	before, _ := a.store.TextProcessing()
	fake := &fakeTextEngine{output: "Preserve names and correct punctuation.", started: make(chan textCall, 1)}
	a.textEngine = fake
	draft := c
	draft.ContextLength = 32768
	if _, err := a.RefinePromptWithConfig("builtin-refine", draft, "Fix punctuation"); err != nil {
		t.Fatal(err)
	}
	call := <-fake.started
	if call.config.Provider != "builtin" || call.config.ContextLength != 32768 {
		t.Fatal("refinement lost the draft context", call)
	}
	after, _ := a.store.TextProcessing()
	if !reflect.DeepEqual(before, after) {
		t.Fatal("refinement persisted its draft connection")
	}
}

func TestTextModelContextPersistsAndRejectsUnsupportedLengths(t *testing.T) {
	a := testApp(t)
	c := textmodel.Defaults()
	c.Provider, c.Model, c.ContextLength = "builtin", "gemma-4-12b", 262144
	got, err := a.SaveTextProcessing(c)
	if err != nil || got.ContextLength != 262144 {
		t.Fatal("could not save context", got, err)
	}
	saved, err := a.store.TextProcessing()
	if err != nil || saved.Provider != "builtin" || saved.ContextLength != 262144 {
		t.Fatal("context was not persisted", saved, err)
	}
	c.Model = "gemma-4-e2b"
	if _, err := a.SaveTextProcessing(c); err == nil {
		t.Fatal("accepted 12B-only context for E2B")
	}
	saved, _ = a.store.TextProcessing()
	if saved.Model != "gemma-4-12b" || saved.ContextLength != 262144 {
		t.Fatal("invalid edit changed persisted settings")
	}
	c.ContextLength = 0
	if _, err := a.SaveTextProcessing(c); err != nil {
		t.Fatal("could not choose automatic context", err)
	}
	if err := a.RemoveTextModel(c.Model); err == nil {
		t.Fatal("removed selected text model")
	}
}
