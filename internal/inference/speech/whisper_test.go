package speech

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The child test process emulates the CLI contract without a shell or inference dependency.
func TestMain(m *testing.M) {
	if mode := os.Getenv("YAP_TEST_WHISPER"); mode != "" {
		if mode == "wait" {
			time.Sleep(10 * time.Second)
			os.Exit(0)
		}
		var out, prompt string
		for i, arg := range os.Args {
			if arg == "-of" && i+1 < len(os.Args) {
				out = os.Args[i+1]
			}
			if arg == "--prompt" && i+1 < len(os.Args) {
				prompt = os.Args[i+1]
			}
		}
		if mode == "prompt" && prompt != os.Getenv("YAP_EXPECT_PROMPT") {
			os.Exit(3)
		}
		if mode == "empty" {
			os.WriteFile(out+".txt", nil, 0600)
		} else {
			os.WriteFile(out+".txt", []byte("  Hello, local world.\n"), 0600)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func testOptions(t *testing.T) Options {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	model := filepath.Join(t.TempDir(), "model with spaces.bin")
	if err = os.WriteFile(model, []byte("model"), 0600); err != nil {
		t.Fatal(err)
	}
	return Options{Executable: exe, Model: model, Language: "auto"}
}
func TestTranscriptAndEmptyOutput(t *testing.T) {
	opts := testOptions(t)
	t.Setenv("YAP_TEST_WHISPER", "text")
	text, err := (Whisper{}).Transcribe(context.Background(), "audio with spaces.wav", opts)
	if err != nil || text != "Hello, local world." {
		t.Fatalf("unexpected transcript: %q %v", text, err)
	}
	t.Setenv("YAP_TEST_WHISPER", "empty")
	if _, err = (Whisper{}).Transcribe(context.Background(), "audio.wav", opts); err == nil {
		t.Fatal("accepted empty transcription")
	}
}
func TestVocabularyPromptIsOneLiteralArgument(t *testing.T) {
	opts := testOptions(t)
	opts.Prompt = "PostgreSQL, C++, O'Reilly, \"Yap\", $(literal)"
	t.Setenv("YAP_TEST_WHISPER", "prompt")
	t.Setenv("YAP_EXPECT_PROMPT", opts.Prompt)
	if _, err := (Whisper{}).Transcribe(context.Background(), "audio.wav", opts); err != nil {
		t.Fatal(err)
	}
}
func TestCancellationTerminatesProcess(t *testing.T) {
	opts := testOptions(t)
	t.Setenv("YAP_TEST_WHISPER", "wait")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := (Whisper{}).Transcribe(ctx, "audio.wav", opts)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancellation not propagated: %v", err)
	}
}
