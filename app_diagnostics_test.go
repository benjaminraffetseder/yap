package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"yap/internal/audio"
	"yap/internal/inference/speech"
	"yap/internal/vocabulary"
)

func diagnosticApp(t *testing.T) *App {
	a := testApp(t)
	a.microphones = func() ([]audio.Device, error) { return []audio.Device{{ID: "usb", Name: "USB microphone"}}, nil }
	return a
}

func TestDiagnosticTranscriptionUsesSavedPipelineWithoutSideEffects(t *testing.T) {
	a := diagnosticApp(t)
	capture := &selectedCapture{}
	a.recorder = capture
	engine := &processingSpeech{text: "um, test postgres"}
	a.engine = engine
	a.settings.MicrophoneID, a.settings.Language = "usb", "en"
	a.settings.CleanText, a.settings.SaveAudio, a.settings.AutoPaste = true, true, true
	a.vocabulary = []vocabulary.Entry{{ID: "one", Canonical: "PostgreSQL", Aliases: []string{"postgres"}, Enabled: true}}
	a.copyText = func(string) error { t.Error("diagnostic changed clipboard"); return nil }
	panel := &fakeIndicator{}
	a.indicator = panel
	if err := a.StartDiagnosticTest(); err != nil {
		t.Fatal(err)
	}
	path := a.path
	if len(capture.devices) != 1 || capture.devices[0] != "usb" {
		t.Fatal("diagnostic ignored selected microphone")
	}
	if a.status.Phase != "diagnostic-recording" || !a.busy() {
		t.Fatal("test capture not busy")
	}
	if err := a.StartRecording(); err == nil {
		t.Fatal("regular recording started during test")
	}
	if err := a.StopMicrophoneTest(); err == nil {
		t.Fatal("mic-only stop accepted dictation test")
	}
	if err := a.SaveSettings(a.settings); err == nil {
		t.Fatal("settings changed during test")
	}
	if err := a.StopDiagnosticTest(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	snapshot, err := a.GetSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Diagnostic.Phase != "done" || snapshot.Diagnostic.Transcript != "Test PostgreSQL." || snapshot.Diagnostic.DurationMS != 2000 {
		t.Fatalf("diagnostic failed: %+v", snapshot.Diagnostic)
	}
	if engine.opts.Prompt != "PostgreSQL" || engine.opts.Language != "en" {
		t.Fatalf("saved preferences ignored: %+v", engine.opts)
	}
	if len(snapshot.History) != 0 || a.indicatorActive || len(panel.states) > 0 || len(panel.levels) > 0 {
		t.Fatal("diagnostic activated dictation side effects")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("test audio retained despite test policy")
	}
}

func TestDiagnosticChecksAndPreflightRejectMissingInputs(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*App)
		id     string
	}{
		{"runtime", func(a *App) { a.settings.WhisperPath = "missing-whisper.exe" }, "runtime"},
		{"model", func(a *App) { a.settings.ModelPath = "missing.bin" }, "model"},
		{"empty model", func(a *App) { os.WriteFile(a.settings.ModelPath, nil, 0600) }, "model"},
		{"disconnected", func(a *App) { a.settings.MicrophoneID = "disconnected" }, "microphone"},
		{"no microphones", func(a *App) { a.microphones = func() ([]audio.Device, error) { return nil, nil } }, "microphone"},
		{"enumeration failure", func(a *App) {
			a.microphones = func() ([]audio.Device, error) { return nil, errors.New("device access failed") }
		}, "microphone"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := diagnosticApp(t)
			tc.change(a)
			checks, err := a.GetDiagnosticChecks()
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, check := range checks {
				if check.ID == tc.id {
					found = !check.Ready && check.Message != ""
				}
			}
			if !found {
				t.Fatalf("missing failure: %+v", checks)
			}
			if err := a.StartDiagnosticTest(); err == nil || a.diagnostic.Phase != "error" {
				t.Fatal("invalid setup started capture")
			}
			if a.busy() || a.path != "" {
				t.Fatal("preflight left capture busy")
			}
		})
	}
}

type failedSpeech struct{ err error }

func (s failedSpeech) Transcribe(context.Context, string, speech.Options) (string, error) {
	return "", s.err
}

func TestDiagnosticFailuresRemoveAudioAndOfferRecovery(t *testing.T) {
	for _, tc := range []struct {
		name    string
		err     error
		message string
	}{
		{"no speech", speech.ErrNoSpeech, "Speak a longer sentence"},
		{"model or runtime", errors.New("Whisper could not load model"), "reinstall the model"},
		{"empty output", nil, "No speech detected"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := diagnosticApp(t)
			a.engine = failedSpeech{tc.err}
			if err := a.StartDiagnosticTest(); err != nil {
				t.Fatal(err)
			}
			path := a.path
			if err := a.StopDiagnosticTest(); err != nil {
				t.Fatal(err)
			}
			a.wg.Wait()
			if a.diagnostic.Phase != "error" || !strings.Contains(a.diagnostic.Message, tc.message) || a.busy() {
				t.Fatalf("bad failure: %+v", a.diagnostic)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("failed test retained audio")
			}
			if tc.name == "model or runtime" && !strings.Contains(a.diagnostic.Details, "could not load model") {
				t.Fatal("technical details lost")
			}
		})
	}
}

func TestDiagnosticSilenceAndCaptureFailure(t *testing.T) {
	a := diagnosticApp(t)
	a.recorder = silentCapture{}
	if err := a.StartDiagnosticTest(); err != nil {
		t.Fatal(err)
	}
	path := a.path
	if err := a.StopDiagnosticTest(); err == nil || a.diagnostic.Phase != "error" {
		t.Fatal("silence passed")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("silence retained")
	}
	a.recorder = &selectedCapture{failure: errors.New("microphone permission denied")}
	if err := a.StartDiagnosticTest(); err == nil || !strings.Contains(a.diagnostic.Message, "microphone access") {
		t.Fatal("capture failure lacks recovery")
	}
	if !strings.Contains(a.diagnostic.Details, "permission denied") {
		t.Fatal("capture detail lost")
	}
}

func TestDiagnosticCancellationAndShutdownCleanBothPhases(t *testing.T) {
	for _, phase := range []string{"recording", "transcribing"} {
		for _, exit := range []string{"cancel", "shutdown"} {
			t.Run(phase+"/"+exit, func(t *testing.T) {
				a := diagnosticApp(t)
				started := make(chan struct{})
				a.engine = fakeSpeech{wait: true, started: started}
				if err := a.StartDiagnosticTest(); err != nil {
					t.Fatal(err)
				}
				path := a.path
				if phase == "transcribing" {
					if err := a.StopDiagnosticTest(); err != nil {
						t.Fatal(err)
					}
					select {
					case <-started:
					case <-time.After(time.Second):
						t.Fatal("test inference not started")
					}
				}
				if exit == "shutdown" {
					a.shutdown(a.ctx)
				} else {
					if err := a.Cancel(); err != nil {
						t.Fatal(err)
					}
					a.wg.Wait()
					if a.busy() || a.diagnostic.Phase != "cancelled" || a.diagnostic.Transcript != "" {
						t.Fatalf("cancelled test stuck: %+v", a.diagnostic)
					}
				}
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Fatal("cancelled test retained audio")
				}
			})
		}
	}
}

func TestDiagnosticTimeoutReturnsToIdle(t *testing.T) {
	a := diagnosticApp(t)
	a.engine = fakeSpeech{wait: true}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	a.ctx = ctx
	if err := a.StartDiagnosticTest(); err != nil {
		t.Fatal(err)
	}
	path := a.path
	if err := a.StopDiagnosticTest(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if a.busy() || a.diagnostic.Phase != "error" || !strings.Contains(a.diagnostic.Message, "timed out") {
		t.Fatalf("timeout stuck: %+v", a.diagnostic)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("timed out test retained audio")
	}
}

func TestDiagnosticAutoStopAndVocabularyInvalidation(t *testing.T) {
	a := diagnosticApp(t)
	if err := a.StartDiagnosticTest(); err != nil {
		t.Fatal(err)
	}
	path := a.path
	a.mu.Lock()
	a.timer.Reset(time.Millisecond)
	a.mu.Unlock()
	deadline := time.Now().Add(time.Second)
	for {
		snapshot, err := a.GetSnapshot()
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Diagnostic.Phase == "done" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("test capture did not stop automatically")
		}
		time.Sleep(time.Millisecond)
	}
	a.wg.Wait()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("automatic test retained audio")
	}
	if _, err := a.SaveVocabulary([]vocabulary.Entry{{ID: "one", Canonical: "Yap", Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	if a.diagnostic.Phase != "" || a.diagnostic.Transcript != "" {
		t.Fatal("changed vocabulary retained stale verification")
	}
}
