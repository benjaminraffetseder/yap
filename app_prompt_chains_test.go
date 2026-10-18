package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

type chainTextEngine struct {
	calls   []textCall
	process func(int, context.Context) (string, error)
}

func (e *chainTextEngine) Refine(context.Context, textmodel.Config, string) (string, error) {
	return "", errors.New("unexpected refinement")
}

func (e *chainTextEngine) Process(ctx context.Context, config textmodel.Config, prompt textmodel.Prompt, input string) (string, error) {
	index := len(e.calls)
	e.calls = append(e.calls, textCall{config, prompt, input})
	if e.process != nil {
		return e.process(index, ctx)
	}
	return fmt.Sprintf("result %d", index+1), nil
}

func enableChain(t *testing.T, a *App, automatic bool) textmodel.Config {
	t.Helper()
	config := enableText(t, a, false)
	config.Prompts = append(config.Prompts, textmodel.Prompt{ID: "email", Name: "Email", Instruction: "Write an email."})
	config.Chains = []textmodel.Chain{{ID: "follow-up", Name: "Follow-up", Steps: []textmodel.ChainStep{
		{ID: "clean", PromptID: "cleanup", Input: "original"},
		{ID: "summarize", PromptID: "summary", Input: "step:clean"},
		{ID: "write", PromptID: "email", Input: "step:summarize"},
	}}}
	if automatic {
		config.AutoPromptID = "follow-up"
	}
	if _, err := a.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	return config
}

func TestManualChainsChooseInputsAndKeepEveryResult(t *testing.T) {
	for _, source := range []string{"original", "transcript", "step:clean", "step:summarize"} {
		t.Run(source, func(t *testing.T) {
			a := testApp(t)
			config := enableChain(t, a, false)
			config.Chains[0].Steps[2].Input = source
			if _, err := a.SaveTextProcessing(config); err != nil {
				t.Fatal(err)
			}
			entry := storage.NewSession("chain-session", 1000, "Original speech", "base", "en", "")
			entry.FinalTranscript = "Edited transcript"
			if err := a.store.Add(entry); err != nil {
				t.Fatal(err)
			}
			a.copyText = func(string) error { t.Error("manual chain copied text"); return nil }
			a.textEngine = &chainTextEngine{}
			output, err := a.GenerateSessionOutput("manual-chain", entry.ID, "follow-up")
			if err != nil || output != "result 3" {
				t.Fatal(output, err)
			}
			calls := a.textEngine.(*chainTextEngine).calls
			expected := map[string]string{"original": entry.RawTranscript, "transcript": entry.FinalTranscript, "step:clean": "result 1", "step:summarize": "result 2"}[source]
			if len(calls) != 3 || calls[0].input != entry.RawTranscript || calls[1].input != "result 1" || calls[2].input != expected {
				t.Fatal("wrong chain inputs", calls)
			}
			outputs, err := a.GetSessionOutputs(entry.ID)
			if err != nil || len(outputs) != 3 {
				t.Fatal(outputs, err)
			}
			byStep := map[int]storage.GeneratedOutput{}
			for _, result := range outputs {
				if result.Chain.RunID == "" || result.Chain.RunID != outputs[0].Chain.RunID || result.Chain.ChainID != "follow-up" || result.Chain.Total != 3 || result.Chain.Name != "Follow-up" {
					t.Fatal("missing lineage", result)
				}
				byStep[result.Chain.Step] = result
			}
			if byStep[2].Chain.SourceOutputID != byStep[1].ID || byStep[3].Input != expected || byStep[3].Prompt.ID != "email" {
				t.Fatal("lost input snapshots", outputs)
			}
			if source == "step:clean" && byStep[3].Chain.SourceOutputID != byStep[1].ID {
				t.Fatal("wrong explicit earlier input")
			}
			got, _ := a.store.Session(entry.ID)
			if got != entry || a.textJobID != "" || a.status.Phase != "idle" {
				t.Fatal("chain changed transcript or leaked ownership", got, a.status)
			}
			// A second run creates independent versions and lineage.
			if _, err := a.GenerateSessionOutput("second-chain", entry.ID, "follow-up"); err != nil {
				t.Fatal(err)
			}
			again, _ := a.GetSessionOutputs(entry.ID)
			runs := map[string]int{}
			for _, output := range again {
				runs[output.Chain.RunID]++
			}
			if len(again) != 6 || len(runs) != 2 || runs[outputs[0].Chain.RunID] != 3 {
				t.Fatal("runs overwrote or reused lineage", again)
			}
		})
	}
}

func TestProfilesCanSelectPromptChains(t *testing.T) {
	a := testApp(t)
	enableChain(t, a, false)
	profile, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Follow-up", ModelPath: a.settings.ModelPath, Language: "en", AutoPromptID: "follow-up"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyDictationProfile(profile.ID); err != nil {
		t.Fatal(err)
	}
	if a.textConfig.AutoPromptID != "follow-up" || !profile.Matches(a.settings, a.textConfig) {
		t.Fatal("profile lost chain")
	}
}

func TestChainsRetainCompletedStepsOnFailureCancellationAndDeletion(t *testing.T) {
	for _, mode := range []string{"failure", "cancel", "delete"} {
		t.Run(mode, func(t *testing.T) {
			a := testApp(t)
			enableChain(t, a, false)
			entry := storage.NewSession("partial", 1000, "Speech", "base", "en", "")
			if err := a.store.Add(entry); err != nil {
				t.Fatal(err)
			}
			started, release := make(chan struct{}), make(chan struct{})
			e := &chainTextEngine{process: func(index int, _ context.Context) (string, error) {
				if index == 0 {
					return "Cleaned", nil
				}
				close(started)
				<-release // Deliberately return a late successful reply after cancellation.
				if mode == "failure" {
					return "", errors.New("model unavailable")
				}
				return "Late summary", nil
			}}
			a.textEngine = e
			done := make(chan error, 1)
			go func() { _, err := a.GenerateSessionOutput("partial-chain", entry.ID, "follow-up"); done <- err }()
			<-started
			outputs, err := a.GetSessionOutputs(entry.ID)
			if err != nil || len(outputs) != 1 || outputs[0].Text != "Cleaned" {
				t.Fatal("first step wasn't committed", outputs, err)
			}
			if _, err := a.SaveTextProcessing(a.textConfig); err == nil {
				t.Fatal("changed chain mid-run")
			}
			if mode == "cancel" {
				a.CancelTextProcessing("partial-chain")
			}
			if mode == "delete" {
				if err := a.DeleteSession(entry.ID); err != nil {
					t.Fatal(err)
				}
			}
			close(release)
			err = <-done
			if err == nil || len(e.calls) != 2 {
				t.Fatal("continued after interrupted step", err, e.calls)
			}
			if mode == "cancel" && !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			if mode == "failure" && !strings.Contains(err.Error(), "step 2 (Summary)") {
				t.Fatal(err)
			}
			outputs, _ = a.store.GeneratedOutputs(entry.ID)
			want := 1
			if mode == "delete" {
				want = 0
			}
			if len(outputs) != want || a.textJobID != "" {
				t.Fatal("late output saved or completed step lost", outputs)
			}
		})
	}
}

func TestAutomaticChainsDeliverOnlyFinalResultAndRespectHistory(t *testing.T) {
	for _, saveHistory := range []bool{true, false} {
		for _, fail := range []bool{false, true} {
			t.Run(fmt.Sprintf("history=%v/fail=%v", saveHistory, fail), func(t *testing.T) {
				a := testApp(t)
				enableChain(t, a, true)
				if err := a.SetSaveHistory(saveHistory); err != nil {
					t.Fatal(err)
				}
				a.textEngine = &chainTextEngine{process: func(index int, _ context.Context) (string, error) {
					if fail && index == 1 {
						return "", errors.New("offline")
					}
					return fmt.Sprintf("step %d", index+1), nil
				}}
				var copies []string
				a.copyText = func(text string) error { copies = append(copies, text); return nil }
				if err := a.StartRecording(); err != nil {
					t.Fatal(err)
				}
				// Captured chains must not share their step slice with later settings.
				a.textConfig.Chains[0].Steps[1].Input = "original"
				if err := a.StopRecording(); err != nil {
					t.Fatal(err)
				}
				a.wg.Wait()
				calls := a.textEngine.(*chainTextEngine).calls
				if calls[1].input != "step 1" {
					t.Fatal("recording did not snapshot its chain", calls)
				}
				want := 3
				if fail {
					want = 1
					if len(copies) != 0 {
						t.Fatal("partial chain was delivered", copies)
					}
				} else if len(copies) != 1 || copies[0] != "step 3" {
					t.Fatal("wrong automatic delivery", copies)
				}
				if !saveHistory {
					history, _ := a.store.History()
					if len(history) != 0 || a.latestResult == nil || len(a.latestResult.Outputs) != want {
						t.Fatal("temporary outputs lost or saved")
					}
					if err := a.SaveLatestResult(a.id); err != nil {
						t.Fatal(err)
					}
				}
				outputs, err := a.GetSessionOutputs(a.id)
				entry, entryErr := a.store.Session(a.id)
				if err != nil || len(outputs) != want || entryErr != nil || entry.RawTranscript != "A private thought." || entry.FinalTranscript != "A private thought." {
					t.Fatal("lost transcript or steps", outputs, entry, err, entryErr)
				}
			})
		}
	}
}
