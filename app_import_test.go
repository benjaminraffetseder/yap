package main

import (
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"yap/internal/audio"
	"yap/internal/inference/speech"
	textmodel "yap/internal/inference/text"
	"yap/internal/vocabulary"
)

func importedWAV(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "my audio.wav")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = audio.Header(f, 32000); err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(make([]byte, 32000)); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return path
}

type importedSpeech struct {
	seen  chan speech.Options
	block bool
}

func (e importedSpeech) Transcribe(ctx context.Context, path string, opts speech.Options) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil || len(data) != 32044 || binary.LittleEndian.Uint32(data[24:]) != 16000 {
		return "", errors.New("not normalized audio")
	}
	if e.seen != nil {
		e.seen <- opts
	}
	if e.block {
		<-ctx.Done()
		return "", ctx.Err()
	}
	return "uh, hello postgres.", nil
}

func TestAudioImportUsesPipelineWithoutClipboardOrSourceChanges(t *testing.T) {
	for _, retain := range []bool{false, true} {
		a := testApp(t)
		a.settings.SaveAudio, a.settings.CleanText = retain, true
		a.vocabulary = []vocabulary.Entry{{ID: "pg", Canonical: "PostgreSQL", Aliases: []string{"postgres"}, Enabled: true}}
		seen := make(chan speech.Options, 1)
		a.engine = importedSpeech{seen: seen}
		a.copyText = func(string) error { t.Error("import touched clipboard"); return nil }
		source := importedWAV(t)
		before, _ := os.ReadFile(source)
		if err := a.importAudio(source); err != nil {
			t.Fatal(err)
		}
		a.wg.Wait()
		if opts := <-seen; opts.Prompt != "PostgreSQL" {
			t.Fatalf("lost vocabulary: %+v", opts)
		}
		entries, err := a.store.History()
		if err != nil || len(entries) != 1 || entries[0].DurationMS != 1000 || entries[0].RawTranscript != "uh, hello postgres." || entries[0].FinalTranscript != "Hello PostgreSQL." {
			t.Fatalf("import pipeline: %+v %v", entries, err)
		}
		if a.status.Phase != "done" || a.status.Message != "Saved to History" {
			t.Fatalf("bad status: %+v", a.status)
		}
		if entries[0].AudioPath == source {
			t.Fatal("stored source path")
		}
		if retain {
			if _, err := os.Stat(entries[0].AudioPath); err != nil {
				t.Fatal(err)
			}
		} else if _, err := os.Stat(a.path); !os.IsNotExist(err) {
			t.Fatal("temporary audio leaked")
		}
		after, _ := os.ReadFile(source)
		if string(before) != string(after) {
			t.Fatal("source changed")
		}
	}
}

func TestAudioImportCancellationAndValidationLeaveNoPartialData(t *testing.T) {
	a := testApp(t)
	a.settings.SaveAudio = true
	seen := make(chan speech.Options, 1)
	a.engine = importedSpeech{seen: seen, block: true}
	if err := a.importAudio(importedWAV(t)); err != nil {
		t.Fatal(err)
	}
	<-seen
	if err := a.StartRecording(); err == nil {
		t.Fatal("recorded during import")
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if history, _ := a.store.History(); len(history) != 0 {
		t.Fatal("cancelled import saved history")
	}
	if _, err := os.Stat(a.path); !os.IsNotExist(err) {
		t.Fatal("cancelled audio leaked")
	}
	bad := filepath.Join(t.TempDir(), "bad.wav")
	os.WriteFile(bad, []byte("not audio"), 0600)
	if err := a.importAudio(bad); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if a.status.Phase != "error" {
		t.Fatal("invalid file was accepted")
	}
	if files, _ := os.ReadDir(filepath.Join(a.store.Dir, "recordings")); len(files) != 0 {
		t.Fatal("failed import left files")
	}
	a.status.Phase = "backup"
	if err := a.importAudio(bad); err == nil {
		t.Fatal("imported while busy")
	}
	a.status.Phase = "idle"
	a.settings.ModelPath = ""
	if err := a.importAudio(bad); err == nil {
		t.Fatal("imported without speech model")
	}
}

func TestAudioImportRunsAutomaticPrompt(t *testing.T) {
	a := testApp(t)
	a.engine = importedSpeech{}
	a.textConfig = textmodel.Defaults()
	a.textConfig.Enabled, a.textConfig.Model, a.textConfig.AutoPromptID = true, "local-model", "summary"
	a.textEngine = &fakeTextEngine{output: "Imported summary."}
	if err := a.importAudio(importedWAV(t)); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	outputs, err := a.store.GeneratedOutputs(a.id)
	if err != nil || len(outputs) != 1 || outputs[0].Text != "Imported summary." {
		t.Fatalf("prompt pipeline: %+v %v", outputs, err)
	}
}

func TestAudioImportShutdownRemovesPendingCopy(t *testing.T) {
	a := testApp(t)
	a.settings.SaveAudio = true
	seen := make(chan speech.Options, 1)
	a.engine = importedSpeech{seen: seen, block: true}
	source := importedWAV(t)
	if err := a.importAudio(source); err != nil {
		t.Fatal(err)
	}
	<-seen
	a.shutdown(a.ctx)
	if _, err := os.Stat(a.path); !os.IsNotExist(err) {
		t.Fatal("shutdown left imported copy")
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatal("shutdown touched source", err)
	}
}

func TestAudioImportRejectsRedirectedStorage(t *testing.T) {
	a := testApp(t)
	recordings := filepath.Join(a.store.Dir, "recordings")
	if err := os.Remove(recordings); err != nil {
		t.Fatal(err)
	}
	external := t.TempDir()
	if err := os.Symlink(external, recordings); err != nil {
		t.Skip("directory symlink unavailable", err)
	}
	if err := a.importAudio(importedWAV(t)); err == nil {
		t.Fatal("import followed redirected storage")
	}
	if files, err := os.ReadDir(external); err != nil || len(files) != 0 {
		t.Fatal("import changed external directory", err)
	}
}
