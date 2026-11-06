package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestChatVoiceUsesLocalSpeechWithoutHistoryClipboardOrHomeChanges(t *testing.T) {
	a := chatApp(t)
	before := a.status
	if err := a.StartChatVoice("voice", "chat"); err != nil {
		t.Fatal(err)
	}
	if err := a.StartRecording(); err == nil {
		t.Fatal("dictation stole the chat microphone")
	}
	if err := a.StopRecording(); err == nil {
		t.Fatal("dictation stopped the chat microphone")
	}
	a.CancelTextProcessing("another-request")
	text, err := a.StopChatVoice("voice")
	if err != nil || text != "A private thought." {
		t.Fatal(text, err)
	}
	if repeated, err := a.StopChatVoice("voice"); err != nil || repeated != text {
		t.Fatal("delayed Stop lost its result", repeated, err)
	}
	entries, err := a.GetHistory("", 0)
	if err != nil || entries.Total != 1 || a.status != before || a.textJobID != "" || a.homeResult != nil || a.latestResult != nil {
		t.Fatal("voice changed dictation state", entries, err, a.status)
	}
	files, _ := filepath.Glob(filepath.Join(a.store.Dir, "recordings", "*"))
	if len(files) != 0 {
		t.Fatal("chat retained voice audio", files)
	}
	chat, _ := a.GetSessionChat("chat")
	if len(chat.Messages) != 0 {
		t.Fatal("voice automatically sent a message")
	}
}

func TestChatVoiceCancellationDuringRecordingAndTranscriptionCleansAudio(t *testing.T) {
	for _, transcribing := range []bool{false, true} {
		t.Run(map[bool]string{false: "recording", true: "transcribing"}[transcribing], func(t *testing.T) {
			a := chatApp(t)
			started := make(chan struct{})
			a.engine = fakeSpeech{wait: true, started: started}
			if err := a.StartChatVoice("voice", "chat"); err != nil {
				t.Fatal(err)
			}
			a.mu.Lock()
			voice := a.chatVoice
			a.mu.Unlock()
			if transcribing {
				done := make(chan error, 1)
				go func() { _, err := a.StopChatVoice("voice"); done <- err }()
				<-started
				a.CancelTextProcessing("voice")
				if err := <-done; !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
			} else {
				a.CancelTextProcessing("voice")
				<-voice.done
			}
			if !errors.Is(voice.err, context.Canceled) || voice.text != "" {
				t.Fatal(voice.text, voice.err)
			}
			if _, err := os.Stat(voice.path); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("voice audio retained", err)
			}
			if a.textJobID != "" || a.status.Phase != "idle" {
				t.Fatal("voice did not release busy state")
			}
		})
	}
}

func TestChatVoiceHonorsEarlyCancellationAndShutdown(t *testing.T) {
	a := chatApp(t)
	a.CancelTextProcessing("early")
	if err := a.StartChatVoice("early", "chat"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err := a.StartChatVoice("voice", "chat"); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	voice := a.chatVoice
	a.mu.Unlock()
	a.shutdown(a.ctx)
	<-voice.done
	if voice.text != "" || !errors.Is(voice.err, context.Canceled) {
		t.Fatal("shutdown delivered a voice draft", voice.text, voice.err)
	}
	if _, err := os.Stat(voice.path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("shutdown retained voice audio", err)
	}
}
