package storage

import (
	"encoding/json"
	"reflect"
	"testing"

	"yap/internal/inference/text"
)

func TestProfileTransactionPreservesDefinitionRevisionsAndRollsThemBack(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "commit", true: "rollback"}[fail], func(t *testing.T) {
			s, err := Open(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			before := text.Defaults()
			before.Chains = []text.Chain{{ID: "chain", Name: "Before", Steps: []text.ChainStep{{ID: "step", PromptID: "cleanup", Input: "original"}}}}
			if err := s.SaveTextProcessing(before); err != nil {
				t.Fatal(err)
			}
			oldPromptRevisions, _ := s.Revisions("prompt", "cleanup")
			oldChainRevisions, _ := s.Revisions("chain", "chain")
			after, _ := text.Normalize(before)
			after.Prompts[0].Instruction = "New instructions"
			after.Chains = nil // Deletion must retain the previous chain.
			if fail {
				if _, err := s.db.Exec(`CREATE TRIGGER reject_workflow BEFORE UPDATE ON text_processing BEGIN SELECT RAISE(FAIL, 'save failure'); END`); err != nil {
					t.Fatal(err)
				}
			}
			settings := Defaults()
			settings.SetupComplete = true
			library := ProfileLibrary{ActiveID: "workflow", Profiles: []DictationProfile{{ID: "workflow", Name: "Workflow", ModelPath: "/model", Language: "en"}}}
			err = s.ApplyDictationProfile(library, settings, after)
			prompts, _ := s.Revisions("prompt", "cleanup")
			chains, _ := s.Revisions("chain", "chain")
			if fail {
				if err == nil || !reflect.DeepEqual(prompts, oldPromptRevisions) || !reflect.DeepEqual(chains, oldChainRevisions) {
					t.Fatal("failed workflow changed revisions", err, prompts, chains)
				}
				stored, _ := s.TextProcessing()
				profiles, _ := s.DictationProfiles()
				if !reflect.DeepEqual(stored, before) || len(profiles.Profiles) != 0 {
					t.Fatal("failed workflow partially committed")
				}
				return
			}
			if err != nil || len(prompts) != 2 || len(chains) != 1 {
				t.Fatal("workflow lost revisions", err, prompts, chains)
			}
			var baseline text.Prompt
			if err := json.Unmarshal([]byte(prompts[1].Value), &baseline); err != nil || baseline.Instruction != before.Prompts[0].Instruction {
				t.Fatal("lost prior prompt", baseline, err)
			}
			if err := s.ApplyDictationProfile(library, settings, after); err != nil {
				t.Fatal(err)
			}
			retry, _ := s.Revisions("prompt", "cleanup")
			if !reflect.DeepEqual(retry, prompts) {
				t.Fatal("identical retry duplicated revisions")
			}
		})
	}
}
