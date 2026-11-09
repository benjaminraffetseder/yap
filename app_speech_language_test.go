package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yap/internal/inference/speech"
	"yap/internal/storage"
)

func TestSpeechLanguageRejectedBeforeRecordingOrImport(t *testing.T) {
	for _, action := range []string{"button", "hotkey", "chat voice", "audio import"} {
		t.Run(action, func(t *testing.T) {
			a := testApp(t)
			entry := storage.NewSession("previous", 1000, "Keep the previous result.", "tiny", "en", "")
			if err := a.store.Add(entry); err != nil {
				t.Fatal(err)
			}
			previous := &HomeResult{Session: entry, Text: entry.FinalTranscript, Saved: true}
			a.homeResult = previous
			model := filepath.Join(a.store.Dir, "models", "moonshine-base")
			if err := os.MkdirAll(model, 0700); err != nil {
				t.Fatal(err)
			}
			bundle := speech.Bundle{Arch: 1, Files: []speech.BundleFile{{Name: "encoder.ort", Size: 7}}}
			manifest, err := json.Marshal(bundle)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(model, speech.BundleManifest), manifest, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(model, "encoder.ort"), []byte("weights"), 0600); err != nil {
				t.Fatal(err)
			}
			runtime := speech.RuntimePath(a.store.Dir, "moonshine")
			if err := os.MkdirAll(filepath.Dir(runtime), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(runtime, []byte("runtime"), 0600); err != nil {
				t.Fatal(err)
			}
			a.settings.ModelPath, a.settings.Language = model, "de"
			recorder := &selectedCapture{}
			a.recorder = recorder
			switch action {
			case "button":
				err = a.StartRecording()
			case "hotkey":
				a.hotkeyDown()
				if a.status.Phase == "error" {
					err = errors.New(a.status.Message)
				}
			case "chat voice":
				err = a.StartChatVoice("voice", entry.ID)
			case "audio import":
				err = a.ImportDroppedAudio([]string{filepath.Join(t.TempDir(), "missing.wav")})
			}
			if err == nil || !strings.Contains(err.Error(), "supports English only") {
				t.Fatalf("incompatible model/language was not rejected before starting: %v", err)
			}
			files, err := os.ReadDir(filepath.Join(a.store.Dir, "recordings"))
			if err != nil {
				t.Fatal(err)
			}
			if len(recorder.devices) != 0 || len(files) != 0 || a.homeResult != previous || len(a.importQueue) != 0 || a.textJobID != "" {
				t.Fatal("rejected language started capture/import or replaced the previous result")
			}
		})
	}
}
