package app

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func draftWorkflow() textmodel.Config {
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "draft-local-model"
	config.Prompts = append(config.Prompts, textmodel.Prompt{ID: "draft-email", Name: "Email", Instruction: "Write an email without inventing facts."})
	config.Chains = []textmodel.Chain{{ID: "draft-chain", Name: "Email workflow", Steps: []textmodel.ChainStep{
		{ID: "original", PromptID: "cleanup", Input: "original"},
		{ID: "cleaned", PromptID: "summary", Input: "transcript"},
		{ID: "email", PromptID: "draft-email", Input: "step:original"},
	}}}
	return config
}

func TestOnboardingDraftWorkflowUsesDistinctSourcesWithoutPersistence(t *testing.T) {
	a := testApp(t)
	before := a.textConfig
	engine := &fakeTextEngine{output: "Result", started: make(chan textCall, 3)}
	a.textEngine = engine
	a.copyText = func(string) error { t.Fatal("trial changed clipboard"); return nil }
	config := draftWorkflow()
	output, err := a.PreviewWorkflow("trial", config, "um original", "Original.", "draft-chain")
	if err != nil || output != "Result" {
		t.Fatal(output, err)
	}
	for index, want := range []string{"um original", "Original.", "Result"} {
		call := <-engine.started
		if call.input != want || call.config.Model != config.Model {
			t.Fatalf("step %d lost draft/source: %+v", index, call)
		}
	}
	if !reflect.DeepEqual(before, a.textConfig) {
		t.Fatal("trial changed saved configuration")
	}
	saved, err := a.store.TextProcessing()
	if err != nil || !reflect.DeepEqual(saved, before) {
		t.Fatal("trial persisted draft configuration", saved, err)
	}
	history, err := a.store.History()
	if err != nil || len(history) != 0 {
		t.Fatal("trial entered history", history, err)
	}
	outputs, err := a.store.GeneratedOutputs("")
	if err != nil || len(outputs) != 0 {
		t.Fatal("trial saved generated output", outputs, err)
	}
}

func TestOnboardingPreviewCancellationAndValidation(t *testing.T) {
	a := testApp(t)
	config := draftWorkflow()
	engine := &fakeTextEngine{output: "Late", started: make(chan textCall, 1), release: make(chan struct{})}
	a.textEngine = engine
	done := make(chan error, 1)
	go func() {
		_, err := a.PreviewWorkflow("active-trial", config, "Original", "Cleaned", "draft-chain")
		done <- err
	}()
	<-engine.started
	a.CancelTextProcessing("active-trial")
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("trial did not cancel")
	}
	if a.textJobID != "" || a.status.Phase != "idle" {
		t.Fatal("trial leaked operation ownership")
	}
	a.CancelTextProcessing("early-trial")
	if _, err := a.PreviewWorkflow("early-trial", config, "Original", "Cleaned", "draft-chain"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	for _, name := range []string{"missing", "empty"} {
		original, recipe := "Original", "missing"
		if name == "empty" {
			original, recipe = "", "draft-chain"
		}
		if _, err := a.PreviewWorkflow("invalid-"+name, config, original, "Cleaned", recipe); err == nil {
			t.Fatal("accepted invalid trial", name)
		}
	}
	engine.release = nil
	engine.started = nil
	engine.err = errors.New("model failed")
	if _, err := a.PreviewWorkflow("failed-trial", config, "Original", "Cleaned", "draft-chain"); err == nil || strings.Contains(err.Error(), "results are kept") {
		t.Fatal("misleading transient failure", err)
	}
}

func TestCompleteOnboardingUsesTestedSpeechSettingsAndActivatesWorkflow(t *testing.T) {
	a := diagnosticApp(t)
	a.settings.SetupComplete = false
	a.shortcutTested = true
	if err := a.StartDiagnosticTest(); err != nil {
		t.Fatal(err)
	}
	if err := a.StopDiagnosticTest(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	config := draftWorkflow()
	config.AutoPromptID = "draft-chain"
	profile := storage.DictationProfile{ID: "my-workflow", Name: "My emails", ModelPath: "untested", Language: "xx"}
	if err := a.CompleteOnboarding(profile, config); err != nil {
		t.Fatal(err)
	}
	if !a.settings.SetupComplete || a.profiles.ActiveID() != profile.ID || a.textConfig.AutoPromptID != config.AutoPromptID {
		t.Fatal("onboarding did not activate the workflow")
	}
	for _, p := range a.profiles.Library().Profiles {
		if p.ID == profile.ID && (p.ModelPath != a.settings.ModelPath || p.Language != a.settings.Language || p.TextModel == nil || p.TextModel.Model != config.Model) {
			t.Fatal("profile did not capture tested choices", p)
		}
	}
	if err := a.CompleteOnboarding(profile, config); err != nil {
		t.Fatal("completion retry failed", err)
	}
}

func TestCompleteOnboardingRejectsMissingFailedAndStaleSpeechTrials(t *testing.T) {
	for _, scenario := range []string{"microphone-only", "failed", "changed-language", "changed-model"} {
		t.Run(scenario, func(t *testing.T) {
			a := diagnosticApp(t)
			a.settings.SetupComplete = false
			a.shortcutTested, a.microphoneTested = true, true
			if scenario != "microphone-only" {
				if scenario == "failed" {
					a.engine = failedSpeech{errors.New("model load failure")}
				}
				if err := a.StartDiagnosticTest(); err != nil {
					t.Fatal(err)
				}
				if err := a.StopDiagnosticTest(); err != nil {
					t.Fatal(err)
				}
				a.wg.Wait()
			}
			if scenario == "changed-language" {
				settings := a.settings
				settings.Language = "de"
				if err := a.SaveSettings(settings); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "changed-model" {
				// Even if the visible diagnostic was not invalidated, a different
				// runtime path cannot borrow the previous successful trial.
				a.settings.WhisperPath = a.settings.ModelPath
			}
			profile := storage.DictationProfile{ID: "new", Name: "My workflow"}
			if err := a.CompleteOnboarding(profile, a.textConfig); err == nil {
				t.Fatal("accepted untested configuration")
			}
			if a.settings.SetupComplete || a.profiles.ActiveID() == profile.ID {
				t.Fatal("failed completion published changes")
			}
		})
	}
}

func TestCompleteOnboardingRequiresDeviceChecks(t *testing.T) {
	a := testApp(t)
	a.settings.SetupComplete = false
	profile := storage.DictationProfile{ID: "new", Name: "My dictation"}
	if err := a.CompleteOnboarding(profile, a.textConfig); err == nil {
		t.Fatal("onboarding bypassed device checks")
	}
	if a.settings.SetupComplete || a.profiles.ActiveID() == profile.ID {
		t.Fatal("failed onboarding published state")
	}
}
