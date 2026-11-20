package recording

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

func recognizedResult(save, audio bool) *Completion {
	settings := storage.Defaults()
	settings.ModelPath, settings.Language = "models/tiny.bin", "en"
	settings.SaveHistory, settings.SaveAudio, settings.AutoGenerateTitles = save, audio, true
	return NewCompletion("session", "recordings/capture.wav", 1200, Recognition{Text: "A useful transcript.", TranscriptionMS: 14.5}, settings, nil, true)
}

func TestSpeechDurabilityAndTemporaryRecovery(t *testing.T) {
	for _, tc := range []struct {
		name                        string
		save, audio, fail, retained bool
	}{
		{"saved audio", true, true, false, true},
		{"saved text", true, false, false, false},
		{"temporary", false, true, false, false},
		{"failed history", true, true, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := recognizedResult(tc.save, tc.audio)
			failure := errors.New("history unavailable")
			writes := 0
			err := result.Save(func(session storage.Session) error {
				writes++
				if session.RawTranscript != "A useful transcript." || session.Stats.TranscriptionMS != 14.5 || session.Stats.Engine != "whisper" || session.SpeechModel != "tiny.bin" {
					t.Fatal("lost speech provenance", session)
				}
				if tc.fail {
					return failure
				}
				return nil
			})
			if errors.Is(err, failure) != tc.fail || (writes == 1) != tc.save || result.DiscardAudio() == tc.retained {
				t.Fatal("wrong durability decision", writes, result, err)
			}
			if !result.Home.Imported || result.Home.Text != "A useful transcript." || result.Home.Session.Stats == nil {
				t.Fatal("lost recoverable result", result.Home)
			}
			saved := tc.save && !tc.fail
			if result.Home.Saved != saved || (result.SessionID() != "") != saved || result.GenerateTitle(textmodel.Config{Enabled: true}) != saved {
				t.Fatal("saved identity or title eligibility diverged", result)
			}
			if !saved && (result.Temporary == nil || result.Temporary.Session.AudioPath != "") {
				t.Fatal("temporary result claimed retained audio", result.Temporary)
			}
			if tc.fail && (result.Home.Outcomes.History != "failed" || !result.HistoryFailure().Warning) {
				t.Fatal("history failure was not recoverable", result.Home)
			}
		})
	}
}

func TestRecognizedTranscriptKeepsOriginalAlongsideVocabularyCleanup(t *testing.T) {
	settings := storage.Defaults()
	settings.CleanText = false
	entries := []vocabulary.Entry{{Canonical: "Yap", Aliases: []string{"yapp"}, Enabled: true}}
	result := NewCompletion("session", "audio.wav", 2000, Recognition{Text: "Use yapp today.", TranscriptionMS: 12}, settings, entries, false)
	if result.Home.Session.RawTranscript != "Use yapp today." || result.Home.Session.FinalTranscript != "Use Yap today." || result.Home.Text != "Use Yap today." {
		t.Fatal("cleanup changed original speech or skipped vocabulary", result.Home)
	}
}

func TestAutomaticOutputsCommitBeforeDependentResults(t *testing.T) {
	for _, save := range []bool{false, true} {
		t.Run(map[bool]string{false: "temporary", true: "saved"}[save], func(t *testing.T) {
			result := recognizedResult(save, false)
			if err := result.Save(func(storage.Session) error { return nil }); err != nil {
				t.Fatal(err)
			}
			committed := storage.GeneratedOutput{ID: "first", SessionID: "session", Text: "First result"}
			writes := 0
			add := func(output storage.GeneratedOutput) error { writes++; return nil }
			if err := result.CommitOutput(committed, add); err != nil {
				t.Fatal(err)
			}
			if (writes == 1) != save || len(result.Home.Outputs) != 1 {
				t.Fatal("output not journaled at its durability boundary", writes, result.Home)
			}
			failure := errors.New("second step failed")
			outcome, complete := result.FinishProcessing(nil, "", failure)
			if complete || !outcome.Warning || outcome.Transcript != "A useful transcript." || len(result.Home.Outputs) != 1 || result.Home.OutputID != "" {
				t.Fatal("partial chain displaced the original speech", result, outcome)
			}
			if !save && (result.Temporary.Output == nil || result.Temporary.Output.ID != "first" || result.Temporary.Text != result.Home.Session.FinalTranscript) {
				t.Fatal("temporary journal lost its completed step", result.Temporary)
			}
			outcome, complete = result.FinishProcessing(context.Canceled, "Ignored result", failure)
			if complete || result.Home.Outcomes.Processing != "cancelled" || outcome.Transcript != "A useful transcript." {
				t.Fatal("cancellation did not win over inference failure", result.Home, outcome)
			}
			outcome, complete = result.FinishProcessing(nil, "Final result", nil)
			if !complete || outcome.Transcript != "Final result" || result.Home.OutputID != "first" {
				t.Fatal("complete result was not selected", outcome, result.Home)
			}
		})
	}
	result := recognizedResult(true, false)
	_ = result.Save(func(storage.Session) error { return nil })
	failure := errors.New("output write failed")
	if err := result.CommitOutput(storage.GeneratedOutput{ID: "unsaved"}, func(storage.GeneratedOutput) error { return failure }); !errors.Is(err, failure) || len(result.Home.Outputs) != 0 {
		t.Fatal("failed output appeared committed", result.Home.Outputs, err)
	}
}

func TestClipboardContextAndPasteOutcomes(t *testing.T) {
	for _, action := range []string{"copy", "copy failure", "paste failure", "cancel during copy", "cancel after paste", "disabled"} {
		t.Run(action, func(t *testing.T) {
			result := recognizedResult(true, false)
			_ = result.Save(func(storage.Session) error { return nil })
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			failure := errors.New("native delivery failed")
			calls := []string{}
			copy := func(string) error { t.Fatal("context copy was bypassed"); return nil }
			copyContext := func(received context.Context, text string) error {
				calls = append(calls, "copy")
				if received != ctx || text != result.Home.Text {
					t.Fatal("copy lost the operation context or result")
				}
				if action == "cancel during copy" {
					cancel()
				}
				if action == "copy failure" {
					return failure
				}
				return nil
			}
			paste := func(target string) error {
				calls = append(calls, "paste:"+target)
				if action == "paste failure" {
					return failure
				}
				return nil
			}
			delivery := Delivery{}
			if action != "disabled" {
				delivery = Deliver(ctx, result.Home.Text, "window", copy, copyContext, paste)
			}
			if action == "cancel after paste" {
				cancel()
			}
			outcome := result.FinishDelivery(delivery, "window", ctx.Err())
			if (action == "copy failure" || action == "paste failure") != outcome.Warning {
				t.Fatal("delivery warning diverged", outcome)
			}
			want := []string{"copy", "paste:window"}
			if action == "disabled" {
				want = []string{}
			} else if action == "copy failure" || action == "cancel during copy" {
				want = []string{"copy"}
			}
			if !reflect.DeepEqual(calls, want) {
				t.Fatal("wrong native effects", calls)
			}
			if ctx.Err() != nil && result.Home.Outcomes.Paste != "skipped" {
				t.Fatal("interrupted paste advertised as requested", result.Home.Outcomes)
			}
			if action == "paste failure" && (result.Home.Outcomes.Clipboard != "complete" || result.Home.Outcomes.Paste != "failed") {
				t.Fatal("paste failure lost copied text", result.Home.Outcomes)
			}
		})
	}
}

func TestCapturePreparationValidatesBeforeAudioAndCleansStartFailure(t *testing.T) {
	settings := storage.Defaults()
	create := func() (*os.File, string, error) {
		t.Fatal("invalid speech settings allocated audio")
		return nil, "", nil
	}
	if _, err := Prepare(settings, textmodel.Defaults(), nil, create, func(string) error { return nil }); err == nil {
		t.Fatal("invalid settings accepted")
	}
	settings.WhisperPath, _ = os.Executable()
	settings.ModelPath = filepath.Join(t.TempDir(), "tiny.bin")
	if err := os.WriteFile(settings.ModelPath, []byte("model"), 0600); err != nil {
		t.Fatal(err)
	}
	file, err := os.CreateTemp(t.TempDir(), "capture-*.wav")
	if err != nil {
		t.Fatal(err)
	}
	startErr, cleanupErr := errors.New("microphone disconnected"), errors.New("audio cleanup failed")
	discard := func(path string) error {
		if path != file.Name() {
			t.Fatal("cleaned the wrong audio", path)
		}
		return cleanupErr
	}
	capture, err := Prepare(settings, textmodel.Defaults(), nil, func() (*os.File, string, error) { return file, file.Name(), nil }, discard)
	if err != nil {
		t.Fatal(err)
	}
	err = capture.Start(stubCapture{startErr: startErr}, "chosen microphone", func(float64) {}, discard)
	if !errors.Is(err, startErr) || !errors.Is(err, cleanupErr) || capture.ID == "" {
		t.Fatal("start failure lost cleanup or identity", capture, err)
	}
}

type stubCapture struct {
	startErr error
	duration int64
	stopErr  error
}

func (capture stubCapture) Start(string, string, func(float64)) error { return capture.startErr }
func (capture stubCapture) Stop() (int64, error)                      { return capture.duration, capture.stopErr }

type stubSpeech struct{ text string }

func (engine stubSpeech) Transcribe(context.Context, string, speech.Options) (string, error) {
	return engine.text, nil
}

func TestVoiceLifecycleRetainsResultAndCleansBeforePublication(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	voice := NewVoice("request", "session", Capture{Path: "voice.wav"})
	voice.Stop()
	voice.Stop()
	select {
	case <-voice.StopSignal():
	default:
		t.Fatal("stop did not signal the worker")
	}
	if err := voice.StopCapture(ctx, stubCapture{duration: 299}); err == nil {
		t.Fatal("short voice capture accepted")
	}
	if _, err := voice.Recognize(ctx, stubSpeech{text: "  "}); !errors.Is(err, speech.ErrNoSpeech) {
		t.Fatal("empty voice draft accepted", err)
	}
	cancel()
	cleanupErr := errors.New("could not discard audio")
	cleaned := false
	err := voice.Finalize(ctx, errors.New("inference failed"), func() error { return errors.New("session deleted") }, func() error { cleaned = true; return cleanupErr })
	if !errors.Is(err, context.Canceled) || !errors.Is(err, cleanupErr) {
		t.Fatal("voice lost cancellation precedence or cleanup failure", err)
	}
	voice.Finish("late private text", err, func(progress VoiceProgress) {
		if !cleaned || progress.Phase != "cancelled" || progress.Text != "" || progress.SessionID != "session" || progress.RequestID != "request" {
			t.Fatal("voice published before cleanup or exposed a cancelled draft", progress)
		}
		select {
		case <-voice.Done():
			t.Fatal("Stop returned before final publication")
		default:
		}
	})
	<-voice.Done()
	voice.Stop()
	if text, err := voice.Result(); text != "" || !errors.Is(err, context.Canceled) {
		t.Fatal("late Stop lost the completed result", text, err)
	}
	voice = NewVoice("next", "session", Capture{})
	err = voice.Finalize(context.Background(), nil, func() error { return errors.New("deleted") }, func() error { return nil })
	voice.Finish("orphaned draft", err, nil)
	if text, err := voice.Result(); text != "" || err == nil || err.Error() != "this transcription no longer exists" {
		t.Fatal("deleted parent retained voice draft", text, err)
	}
}
