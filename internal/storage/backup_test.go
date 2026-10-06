package storage

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	textmodel "yap/internal/inference/text"
	"yap/internal/vocabulary"
)

func TestBackupMetadataBudgetStopsSnapshotCollection(t *testing.T) {
	s := backupStore(t)
	for i := 0; i < 10; i++ {
		if err := s.Add(NewSession(fmt.Sprint(i), 1000, strings.Repeat("\t", 1000), "tiny", "en", "")); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	m, err := backupSnapshotBounded(context.Background(), tx, 10000)
	if err == nil || !strings.Contains(err.Error(), "metadata exceeds") || len(m.Sessions) >= 10 {
		t.Fatal("snapshot was not bounded before loading library", len(m.Sessions), err)
	}
	encoded, _ := json.Marshal(m)
	if len(encoded) > 10000 {
		t.Fatal("retained snapshot exceeded encoded budget")
	}
}

func TestOversizedBackupMetadataPreservesDestinationBeforeAudio(t *testing.T) {
	s := backupStore(t)
	badAudio := filepath.Join(s.Dir, "recordings", "directory.wav")
	os.Mkdir(badAudio, 0700)
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Repeat("a", 100000)
	for i := 0; i < 350; i++ {
		if _, err = tx.Exec("INSERT INTO recordings VALUES(?,?,?,?,?,?,?)", fmt.Sprint(i), "2026-10-08T00:00:00Z", 1000, text, "tiny", "en", badAudio); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "keep.zip")
	os.WriteFile(path, []byte("previous backup"), 0600)
	if _, err = s.ExportBackup(context.Background(), path, true); err == nil || !strings.Contains(err.Error(), "metadata exceeds") {
		t.Fatal("did not reject before audio processing", err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil || string(bytes) != "previous backup" {
		t.Fatal("previous destination changed", err)
	}
}

func TestBackupPreviewPlanningHonorsCancellation(t *testing.T) {
	source, path := backupFixture(t)
	if _, err := source.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	tx, err := dest.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	finished := make(chan error, 1)
	go func() { _, err := dest.PreviewBackup(ctx, archive); finished <- err }()
	select {
	case err := <-finished:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled preview: %v", err)
		}
	case <-time.After(time.Second):
		tx.Rollback()
		<-finished
		t.Fatal("cancelled preview waited for SQLite")
	}
	if _, err := planBackup(ctx, tx, archive); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled plan: %v", err)
	}
}

func backupStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestBackupPreservesAutoStopDurationOverrun(t *testing.T) {
	source := backupStore(t)
	entry := NewSession("auto-stopped", 600001, "Timer stopped dictation.", "base", "en", "")
	if err := source.Add(entry); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "backup.zip")
	if _, err := source.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	if _, err := dest.RestoreBackup(context.Background(), archive, false); err != nil {
		t.Fatal(err)
	}
	got, err := dest.Session(entry.ID)
	if err != nil || got.DurationMS != entry.DurationMS {
		t.Fatalf("duration changed: %+v %v", got, err)
	}
}
func backupFixture(t *testing.T) (*Store, string) {
	t.Helper()
	s := backupStore(t)
	settings := Defaults()
	settings.Language, settings.Interaction, settings.CleanText = "de", "toggle", true
	settings.ModelPath, settings.WhisperPath, settings.MicrophoneID, settings.Shortcut = "SOURCE_MODEL", "SOURCE_RUNTIME", "SOURCE_MIC", "Ctrl+Shift+F1"
	settings.LaunchAtLogin, settings.StartInTray, settings.SetupComplete, settings.HistoryRetentionDays = true, true, true, 7
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Enabled, config.Endpoint, config.Model, config.AutoPromptID = true, "http://127.0.0.1:1234/v1", "source-model", "summary"
	config.Prompts = append(config.Prompts, textmodel.Prompt{ID: "ticket", Name: "Ticket", Instruction: "Write a ticket."})
	config.Prompts[0].Instruction = "My customized cleanup instructions."
	if err := s.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveVocabulary([]vocabulary.Entry{{ID: "postgres", Canonical: "PostgreSQL", Aliases: []string{"postgres"}, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	audioPath := filepath.Join(s.Dir, "recordings", "source.wav")
	if err := os.WriteFile(audioPath, []byte("retained audio"), 0600); err != nil {
		t.Fatal(err)
	}
	session := NewSession("source", 2000, "Original.", "small", "en", audioPath)
	session.FinalTranscript = "My correction."
	if err := s.Add(session); err != nil {
		t.Fatal(err)
	}
	output := NewGeneratedOutput("source", session.FinalTranscript, "A summary.", config, config.Prompts[1])
	output.ID = "generated"
	if err := s.AddGeneratedOutput(output); err != nil {
		t.Fatal(err)
	}
	return s, filepath.Join(t.TempDir(), "portable.zip")
}

func TestBackupRoundTripAllHistoryAndPortableSettings(t *testing.T) {
	source, path := backupFixture(t)
	for i := 0; i < 501; i++ {
		v := NewSession("x"+time.Unix(int64(i), 0).Format("20060102150405"), 1000, "Past dictation.", "base", "en", "")
		if err := source.Add(v); err != nil {
			t.Fatal(err)
		}
	}
	summary, err := source.ExportBackup(context.Background(), path, true)
	if err != nil || summary.Sessions != 502 || summary.Outputs != 1 || summary.Recordings != 1 {
		t.Fatalf("incomplete export: %+v %v", summary, err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	manifest, _ := json.Marshal(archive.manifest)
	for _, secret := range []string{"SOURCE_MODEL", "SOURCE_RUNTIME", "SOURCE_MIC", "Ctrl+Shift+F1", source.Dir} {
		if strings.Contains(string(manifest), secret) {
			t.Fatalf("machine-specific preference leaked: %s", secret)
		}
	}
	dest := backupStore(t)
	local := Defaults()
	local.ModelPath, local.WhisperPath, local.MicrophoneID, local.Shortcut = "LOCAL_MODEL", "LOCAL_RUNTIME", "LOCAL_MIC", "Alt+Space"
	local.SetupComplete, local.HistoryRetentionDays = true, 90
	if err := dest.SaveSettings(local); err != nil {
		t.Fatal(err)
	}
	preview, err := dest.PreviewBackup(context.Background(), archive)
	if err != nil || preview.Sessions != 502 || preview.Outputs != 1 {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	before, _ := dest.SearchHistory("", 0)
	files, _ := os.ReadDir(filepath.Join(dest.Dir, "recordings"))
	if before.Total != 0 || len(files) != 0 {
		t.Fatal("preview changed local data")
	}
	result, err := dest.RestoreBackup(context.Background(), archive, true)
	if err != nil {
		t.Fatal(err)
	}
	want := local
	want.Language, want.Interaction, want.CleanText = "de", "toggle", true
	if result.Settings != want {
		t.Fatalf("device settings changed: %+v", result.Settings)
	}
	v, err := dest.Session("source")
	if err != nil || v.RawTranscript != "Original." || v.FinalTranscript != "My correction." || filepath.Dir(v.AudioPath) != filepath.Join(dest.Dir, "recordings") {
		t.Fatalf("transcript roundtrip: %+v %v", v, err)
	}
	audio, err := os.ReadFile(v.AudioPath)
	if err != nil || string(audio) != "retained audio" {
		t.Fatal("audio roundtrip failed", err)
	}
	outputs, _ := dest.GeneratedOutputs(v.ID)
	if len(outputs) != 1 || outputs[0].Text != "A summary." || outputs[0].Input != "My correction." {
		t.Fatalf("lost saved output: %+v", outputs)
	}
	if result.TextProcessing.Enabled || result.TextProcessing.Model != "" || result.TextProcessing.Endpoint != textmodel.Defaults().Endpoint || result.TextProcessing.AutoPromptID != "" {
		t.Fatalf("server config imported: %+v", result.TextProcessing)
	}
	if result.Summary.Prompts != 3 || result.TextProcessing.Prompts[0].Instruction != "My customized cleanup instructions." {
		t.Fatal("fresh installation lost customized built-in prompts")
	}
	second, err := dest.RestoreBackup(context.Background(), archive, true)
	if err != nil || second.Summary.Sessions != 0 || second.Summary.Outputs != 0 || second.Summary.Vocabulary != 0 || second.Summary.Prompts != 0 {
		t.Fatalf("retry duplicated data: %+v %v", second.Summary, err)
	}
	files, _ = os.ReadDir(filepath.Join(dest.Dir, "recordings"))
	if len(files) != 1 {
		t.Fatal("retry copied audio again")
	}
	dest.Close()
	reopened, err := Open(dest.Dir)
	if err != nil {
		t.Fatal(err)
	}
	dest.db = reopened.db
	got, _ := dest.Settings()
	history, _ := dest.SearchHistory("", 0)
	if got != want || history.Total != 502 {
		t.Fatal("restore did not persist")
	}
}

func TestBackupKeepsConflictsAndPreferencesOptional(t *testing.T) {
	source, path := backupFixture(t)
	if _, err := source.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	existing := NewSession("source", 1000, "Different local dictation.", "base", "en", "")
	if err := dest.Add(existing); err != nil {
		t.Fatal(err)
	}
	config := textmodel.Defaults()
	config.Prompts[0].Instruction = "Local cleanup instructions."
	if err := dest.SaveTextProcessing(config); err != nil {
		t.Fatal(err)
	}
	if err := dest.SaveVocabulary([]vocabulary.Entry{{ID: "local", Canonical: "Postgres", Aliases: []string{"postgres"}, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	result, err := dest.RestoreBackup(context.Background(), archive, false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Settings != Defaults() || result.Summary.DuplicateSessions != 1 || result.Summary.DuplicateOutputs != 1 || result.Summary.SkippedVocabulary != 1 || result.Summary.SkippedPrompts != 2 || result.Summary.Prompts != 1 {
		t.Fatalf("conflict handling: %+v", result)
	}
	v, _ := dest.Session("source")
	if v != existing || result.TextProcessing.Prompts[0].Instruction != "Local cleanup instructions." || len(result.Vocabulary) != 1 {
		t.Fatal("local conflict overwritten")
	}
}

func TestBackupRestoreRollsBackDatabaseAndAudio(t *testing.T) {
	source, path := backupFixture(t)
	if _, err := source.ExportBackup(context.Background(), path, true); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	if _, err := dest.db.Exec(`CREATE TRIGGER reject_restore BEFORE INSERT ON generated_outputs BEGIN SELECT RAISE(ABORT,'disk failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := dest.RestoreBackup(context.Background(), archive, true); err == nil {
		t.Fatal("accepted failed write")
	}
	history, _ := dest.SearchHistory("", 0)
	files, _ := os.ReadDir(filepath.Join(dest.Dir, "recordings"))
	settings, _ := dest.Settings()
	if history.Total != 0 || len(files) != 0 || settings != Defaults() {
		t.Fatal("partial restore changed local data")
	}
	if _, err := dest.db.Exec("DROP TRIGGER reject_restore"); err != nil {
		t.Fatal(err)
	}
	if _, err := dest.RestoreBackup(context.Background(), archive, false); err != nil {
		t.Fatal("retry failed", err)
	}
}

func writeBackupArchive(t *testing.T, path string, manifest backupManifest, extra map[string][]byte) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w := zip.NewWriter(f)
	data, _ := json.Marshal(manifest)
	entry, err := w.Create("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	entry.Write(data)
	for name, data := range extra {
		header := &zip.FileHeader{Name: name, Method: zip.Store}
		if strings.HasSuffix(name, "link.wav") {
			header.SetMode(os.ModeSymlink | 0600)
		}
		entry, err = w.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		entry.Write(data)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestBackupRejectsUnsupportedAndUnsafeArchives(t *testing.T) {
	source, path := backupFixture(t)
	if _, err := source.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	m := archive.manifest
	archive.Close()
	for _, kind := range []string{"version", "traversal", "unreferenced", "missing", "duplicate-id", "orphan-output", "oversize", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			data := m
			data.Sessions = append([]Session{}, m.Sessions...)
			data.Outputs = append([]GeneratedOutput{}, m.Outputs...)
			extra := map[string][]byte{}
			switch kind {
			case "version":
				data.Version++
			case "traversal":
				data.Sessions[0].AudioPath = "../escape.wav"
				extra["../escape.wav"] = []byte("bad")
			case "unreferenced":
				extra["audio/extra.wav"] = []byte("bad")
			case "missing":
				data.Sessions[0].AudioPath = archiveAudioName("source")
			case "duplicate-id":
				data.Sessions = append(data.Sessions, data.Sessions[0])
			case "orphan-output":
				data.Outputs[0].SessionID = "missing"
			case "oversize":
				data.Sessions[0].RawTranscript = strings.Repeat("x", 100001)
			case "symlink":
				extra["audio/link.wav"] = []byte("target")
			}
			file := filepath.Join(t.TempDir(), "bad.zip")
			writeBackupArchive(t, file, data, extra)
			if got, err := ReadBackup(context.Background(), file); err == nil {
				got.Close()
				t.Fatal("accepted invalid archive")
			}
		})
	}
}

func TestBackupChangedAudioAndCancelledOperationsPreserveData(t *testing.T) {
	source, path := backupFixture(t)
	tx, err := source.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	m, err := backupSnapshot(context.Background(), tx)
	tx.Rollback()
	if err != nil {
		t.Fatal(err)
	}
	name := archiveAudioName("source")
	m.Sessions[0].AudioPath = name
	writeBackupArchive(t, path, m, map[string][]byte{name: []byte("retained audio")})
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	offset, err := archive.audio[name].DataOffset()
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.WriteAt([]byte("changed bytes!"), offset)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	dest := backupStore(t)
	if _, err := dest.RestoreBackup(context.Background(), archive, false); err == nil {
		t.Fatal("restored changed audio")
	}
	files, _ := os.ReadDir(filepath.Join(dest.Dir, "recordings"))
	history, _ := dest.SearchHistory("", 0)
	if len(files) != 0 || history.Total != 0 {
		t.Fatal("damaged restore left partial data")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := dest.RestoreBackup(ctx, archive, true); err == nil {
		t.Fatal("restored after cancellation")
	}
	previous := []byte("keep previous backup")
	previousPath := filepath.Join(t.TempDir(), "previous.zip")
	os.WriteFile(previousPath, previous, 0600)
	if _, err := source.ExportBackup(ctx, previousPath, true); err == nil {
		t.Fatal("export ignored cancellation")
	}
	got, _ := os.ReadFile(previousPath)
	if string(got) != string(previous) {
		t.Fatal("failed export replaced previous backup")
	}
}

func TestBackupMissingAudioAndManagedDestination(t *testing.T) {
	source, path := backupFixture(t)
	if err := os.Remove(filepath.Join(source.Dir, "recordings", "source.wav")); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(t.TempDir(), "external.wav")
	if err := os.WriteFile(external, []byte("external audio"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := source.Add(NewSession("external", 1000, "External path", "base", "en", external)); err != nil {
		t.Fatal(err)
	}
	summary, err := source.ExportBackup(context.Background(), path, true)
	if err != nil || summary.Recordings != 0 || summary.MissingRecordings != 2 {
		t.Fatalf("missing audio: %+v %v", summary, err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	if len(archive.audio) != 0 || len(archive.manifest.Sessions) != 2 {
		t.Fatal("missing audio discarded transcripts")
	}
	if _, err := source.ExportBackup(context.Background(), filepath.Join(source.Dir, "database.sqlite"), false); err == nil {
		t.Fatal("overwrote live database")
	}
	if _, err := source.SearchHistory("", 0); err != nil {
		t.Fatal("database changed", err)
	}
}

func TestBackupRejectsRedirectedRecordingStorage(t *testing.T) {
	source, path := backupFixture(t)
	if _, err := source.ExportBackup(context.Background(), path, true); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	dest := backupStore(t)
	directory := filepath.Join(dest.Dir, "recordings")
	if err := os.Remove(directory); err != nil {
		t.Fatal(err)
	}
	external := t.TempDir()
	if err := os.Symlink(external, directory); err != nil {
		t.Skip("directory symlink unavailable", err)
	}
	if _, err := dest.RestoreBackup(context.Background(), archive, true); err == nil {
		t.Fatal("restored into redirected storage")
	}
	files, _ := os.ReadDir(external)
	history, _ := dest.SearchHistory("", 0)
	if len(files) != 0 || history.Total != 0 {
		t.Fatal("redirected restore changed data")
	}
}
