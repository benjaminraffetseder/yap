package main

import (
	"context"
	"os"
	"strings"
	"testing"

	"yap/internal/inference/speech"
	"yap/internal/vocabulary"
)

type silentCapture struct{ fakeCapture }

func (silentCapture) Start(path, mic string, level func(float64)) error {
	level(0)
	return os.WriteFile(path, []byte("silence"), 0600)
}

func TestMicrophoneTestWithoutModelAndCleanup(t *testing.T) {
	for _, exit := range []string{"stop", "cancel", "shutdown"} {
		t.Run(exit, func(t *testing.T) {
			a := testApp(t)
			a.settings.WhisperPath, a.settings.ModelPath = "", ""
			a.settings.SaveAudio = true
			a.engine = fakeSpeech{wait: true} // Test capture must not invoke inference.
			if err := a.StartMicrophoneTest(); err != nil {
				t.Fatal(err)
			}
			path := a.path
			if a.status.Phase != "mic-test" || a.indicatorActive {
				t.Fatal("wrong microphone test state")
			}
			if err := a.StartRecording(); err == nil {
				t.Fatal("recording allowed during test")
			}
			if _, err := a.SaveVocabulary(nil); err == nil {
				t.Fatal("edit allowed during test")
			}
			if err := a.CompleteSetup(true); err == nil {
				t.Fatal("setup finished during test")
			}
			switch exit {
			case "stop":
				if err := a.StopMicrophoneTest(); err != nil {
					t.Fatal(err)
				}
				if !a.microphoneTested {
					t.Fatal("signal not recognized")
				}
			case "cancel":
				if err := a.Cancel(); err != nil {
					t.Fatal(err)
				}
				if a.microphoneTested {
					t.Fatal("cancelled test counted as passed")
				}
			case "shutdown":
				a.shutdown(a.ctx)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("test audio retained")
			}
			if exit != "shutdown" {
				history, err := a.store.History()
				if err != nil || len(history) != 0 {
					t.Fatal("microphone test saved transcript")
				}
			}
		})
	}
}

func TestSilenceDoesNotPassMicrophoneTest(t *testing.T) {
	a := testApp(t)
	a.recorder = silentCapture{}
	if err := a.StartMicrophoneTest(); err != nil {
		t.Fatal(err)
	}
	path := a.path
	if err := a.StopMicrophoneTest(); err == nil || !strings.Contains(err.Error(), "no microphone signal") {
		t.Fatalf("silence accepted: %v", err)
	}
	if a.microphoneTested || a.status.Phase != "idle" {
		t.Fatal("silence passed or capture stuck")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("silent audio retained")
	}
}

func TestSetupRequiresModelMicAndShortcutAndCanBeReopened(t *testing.T) {
	a := testApp(t)
	if err := a.RestartSetup(); err != nil {
		t.Fatal(err)
	}
	if err := a.CompleteSetup(false); err == nil {
		t.Fatal("setup finished without mic test")
	}
	if err := a.StartMicrophoneTest(); err != nil {
		t.Fatal(err)
	}
	if err := a.StopMicrophoneTest(); err != nil {
		t.Fatal(err)
	}
	if err := a.CompleteSetup(false); err == nil {
		t.Fatal("setup finished without shortcut test")
	}
	a.hotkeyDown()
	a.hotkeyUp()
	if !a.shortcutTested || a.status.Phase == "recording" {
		t.Fatal("setup shortcut started recording")
	}
	a.status.ShortcutError = "shortcut unavailable"
	if err := a.CompleteSetup(false); err == nil {
		t.Fatal("shortcut error ignored")
	}
	a.status.ShortcutError = ""
	modelPath := a.settings.ModelPath
	a.settings.ModelPath = "missing.bin"
	if err := a.CompleteSetup(false); err == nil {
		t.Fatal("missing model accepted")
	}
	a.settings.ModelPath = modelPath
	if err := a.CompleteSetup(false); err != nil {
		t.Fatal(err)
	}
	if err := a.RestartSetup(); err != nil {
		t.Fatal(err)
	}
	if err := a.CompleteSetup(true); err != nil {
		t.Fatal(err)
	}
	saved, err := a.store.Settings()
	if err != nil || !saved.SetupComplete {
		t.Fatal("setup completion not saved")
	}
	if err := a.RestartSetup(); err != nil {
		t.Fatal(err)
	}
	if a.settings.SetupComplete || a.microphoneTested || a.shortcutTested {
		t.Fatal("reopen did not reset setup")
	}
}

type processingSpeech struct {
	opts speech.Options
	text string
}

func (s *processingSpeech) Transcribe(_ context.Context, _ string, opts speech.Options) (string, error) {
	s.opts = opts
	return s.text, nil
}

func TestVocabularyAndCleanupUseRecordingSnapshotAndPreserveOriginal(t *testing.T) {
	a := testApp(t)
	engine := &processingSpeech{text: "um, send postgres to Uh Tools"}
	a.engine = engine
	a.settings.Language, a.settings.CleanText = "en", true
	entries := []vocabulary.Entry{{ID: "one", Canonical: "PostgreSQL", Aliases: []string{"postgres"}, Enabled: true}, {ID: "two", Canonical: "Uh Tools", Enabled: true}}
	if _, err := a.SaveVocabulary(entries); err != nil {
		t.Fatal(err)
	}
	entries[0].Aliases[0] = "mutated caller"
	var copied string
	a.copyText = func(text string) error { copied = text; return nil }
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	// Even changes after capture begins cannot change processing of that capture.
	a.mu.Lock()
	a.vocabulary = nil
	a.settings.CleanText = false
	a.mu.Unlock()
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if engine.opts.Prompt != "PostgreSQL, Uh Tools" {
		t.Fatalf("prompt not snapshotted: %q", engine.opts.Prompt)
	}
	if copied != "Send PostgreSQL to Uh Tools." {
		t.Fatalf("processed clipboard: %q", copied)
	}
	history, err := a.store.History()
	if err != nil || len(history) != 1 || history[0].RawTranscript != engine.text || history[0].FinalTranscript != copied {
		t.Fatalf("original/final lost: %+v %v", history, err)
	}
}

func TestVocabularyAndSetupSaveFailuresKeepState(t *testing.T) {
	a := testApp(t)
	entries := []vocabulary.Entry{{ID: "one", Canonical: "Yap", Enabled: true}}
	if _, err := a.SaveVocabulary(entries); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SaveVocabulary([]vocabulary.Entry{{ID: "one"}}); err == nil || a.vocabulary[0].Canonical != "Yap" {
		t.Fatal("validation replaced vocabulary")
	}
	if err := a.store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SaveVocabulary(nil); err == nil || len(a.vocabulary) != 1 {
		t.Fatal("failed save changed memory")
	}
	if err := a.RestartSetup(); err == nil || !a.settings.SetupComplete {
		t.Fatal("failed reopen changed setup")
	}
	a.settings.SetupComplete = false
	if err := a.CompleteSetup(true); err == nil || a.settings.SetupComplete {
		t.Fatal("failed completion changed setup")
	}
}
