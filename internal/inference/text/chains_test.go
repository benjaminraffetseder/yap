package text

import (
	"encoding/json"
	"testing"
)

func chainConfig() Config {
	v := Defaults()
	v.Enabled, v.Model = true, "local-model"
	v.Chains = []Chain{{ID: "notes", Name: "Notes", Steps: []ChainStep{
		{ID: "a", PromptID: "cleanup", Input: "original"},
		{ID: "b", PromptID: "summary", Input: "step:a"},
	}}}
	v.AutoPromptID = "notes"
	return v
}

func TestChainValidationAndSnapshotIsolation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*Config)
	}{
		{"missing prompt", func(v *Config) { v.Chains[0].Steps[0].PromptID = "missing" }},
		{"empty chain", func(v *Config) { v.Chains[0].Steps = nil }},
		{"forward reference", func(v *Config) { v.Chains[0].Steps[0].Input = "step:b" }},
		{"self reference", func(v *Config) { v.Chains[0].Steps[0].Input = "step:a" }},
		{"missing reference", func(v *Config) { v.Chains[0].Steps[1].Input = "step:missing" }},
		{"duplicate step", func(v *Config) { v.Chains[0].Steps[1].ID = "a" }},
		{"duplicate chain", func(v *Config) { v.Chains = append(v.Chains, v.Chains[0]) }},
		{"prompt ID collision", func(v *Config) { v.Chains[0].ID = "cleanup" }},
		{"blank name", func(v *Config) { v.Chains[0].Name = " " }},
		{"nested chain", func(v *Config) { v.Chains[0].Steps[1].PromptID = "notes" }},
		{"unknown input", func(v *Config) { v.Chains[0].Steps[1].Input = "previous" }},
		{"too many steps", func(v *Config) {
			for len(v.Chains[0].Steps) < 11 {
				v.Chains[0].Steps = append(v.Chains[0].Steps, ChainStep{})
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := chainConfig()
			tc.change(&v)
			if _, err := Normalize(v); err == nil {
				t.Fatal("accepted invalid chain")
			}
		})
	}
	v := chainConfig()
	snapshot, err := Normalize(v)
	if err != nil {
		t.Fatal(err)
	}
	v.Chains[0].Steps[1].Input = "original"
	if snapshot.Chains[0].Steps[1].Input != "step:a" {
		t.Fatal("chain snapshot shares a step slice")
	}
	if recipe, err := snapshot.Recipe("notes"); err != nil || len(recipe.Steps) != 2 {
		t.Fatal(recipe, err)
	}
	if recipe, err := snapshot.Recipe("cleanup"); err != nil || recipe.ID != "" || recipe.Steps[0].Input != "transcript" {
		t.Fatal("legacy prompt changed", recipe, err)
	}
}

func TestLegacyProcessingConfigAcceptsChains(t *testing.T) {
	var v Config
	if err := json.Unmarshal([]byte(`{"endpoint":"http://127.0.0.1:11434/v1","prompts":[]}`), &v); err != nil {
		t.Fatal(err)
	}
	if _, err := Normalize(v); err != nil {
		t.Fatal("legacy settings no longer load", err)
	}
}
