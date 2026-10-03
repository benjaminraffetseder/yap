package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yap/internal/storage"
)

func TestBackupRestorePreservesEffectiveMachineSettings(t *testing.T) {
	for _, preferences := range []bool{false, true} {
		a := testApp(t)
		stored := a.settings
		stored.WhisperPath, stored.LaunchAtLogin = "old-bundle-runtime", false
		stored.Language = "de"
		if err := a.store.SaveSettings(stored); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), "backup.zip")
		if _, err := a.exportBackup(path, false); err != nil {
			t.Fatal(err)
		}
		stored.Language = a.settings.Language
		if err := a.store.SaveSettings(stored); err != nil {
			t.Fatal(err)
		}
		// Startup reconciles bundled paths and native startup registration in memory.
		a.settings.LaunchAtLogin = true
		local := a.settings
		preview, err := a.previewBackup(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := a.RestoreBackup(preview.ID, preferences); err != nil {
			t.Fatal(err)
		}
		if preferences {
			local.Language = "de"
		}
		if a.settings != local {
			t.Fatalf("effective machine settings changed (preferences=%v): got %+v want %+v", preferences, a.settings, local)
		}
	}
}

func TestBackupSnapshotAndCancellationDoNotQueryDatabase(t *testing.T) {
	a := testApp(t)
	entry := storage.NewSession("saved", 1000, "Current History", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	previous, ctx, err := a.beginBackupLocked("Restoring backup…")
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { a.mu.Lock(); a.finishBackupLocked(previous); a.mu.Unlock(); a.wg.Done() }()
	// No query is possible now, as when restore owns the sole DB connection.
	if err := a.store.Close(); err != nil {
		t.Fatal(err)
	}
	snapshot, err := a.GetSnapshot()
	if err != nil || snapshot.Status.Phase != "backup" || len(snapshot.History) != 1 || snapshot.History[0].ID != entry.ID {
		t.Fatalf("backup snapshot queried SQLite: %+v %v", snapshot, err)
	}
	if err := a.Cancel(); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != context.Canceled {
		t.Fatal("backup cancellation did not reach operation")
	}
}

func TestBackupBlocksHistoryAccessAndMutation(t *testing.T) {
	a := testApp(t)
	entry := storage.NewSession("current", 1000, "Saved transcript", "base", "en", "")
	if err := a.store.Add(entry); err != nil {
		t.Fatal(err)
	}
	a.id, a.status = entry.ID, Status{Phase: "done", Transcript: entry.FinalTranscript}
	a.mu.Lock()
	previous, _, err := a.beginBackupLocked("Checking backup…")
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { a.mu.Lock(); a.finishBackupLocked(previous); a.mu.Unlock(); a.wg.Done() }()
	checks := []struct {
		name string
		call func() error
	}{
		{"history", func() error { _, err := a.GetHistory("", 0); return err }},
		{"session", func() error { _, err := a.GetSession(entry.ID); return err }},
		{"audio", func() error { _, err := a.GetAudio(entry.ID); return err }},
		{"outputs", func() error { _, err := a.GetSessionOutputs(entry.ID); return err }},
		{"edit", func() error { return a.SaveTranscript(entry.ID, "Changed transcript") }},
		{"delete output", func() error { return a.DeleteSessionOutput(entry.ID, "output") }},
		{"delete session", func() error { return a.DeleteSessions([]string{entry.ID}) }},
	}
	for _, check := range checks {
		if err := check.call(); err == nil || !strings.Contains(err.Error(), "backup") {
			t.Errorf("%s was not blocked during backup: %v", check.name, err)
		}
	}
	current, err := a.store.Session(entry.ID)
	if err != nil || current.FinalTranscript != entry.FinalTranscript {
		t.Fatalf("backup allowed history changes: %+v %v", current, err)
	}
}

func TestBackupAppPreviewRestoreAndDeviceState(t *testing.T) {
	a := testApp(t)
	if err := a.store.SaveSettings(a.settings); err != nil {
		t.Fatal(err)
	}
	local := a.settings
	session := storage.NewSession("backed-up", 1000, "Original", "base", "en", "")
	if err := a.store.Add(session); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "backup.zip")
	if _, err := a.exportBackup(path, false); err != nil {
		t.Fatal(err)
	}
	if err := a.store.Delete(session.ID); err != nil {
		t.Fatal(err)
	}
	preview, err := a.previewBackup(path)
	if err != nil || preview.Summary.Sessions != 1 {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	if _, err := a.RestoreBackup("wrong-preview", true); err == nil {
		t.Fatal("accepted unapproved preview")
	}
	if _, err := a.store.Session(session.ID); err == nil {
		t.Fatal("preview wrote History")
	}
	a.status.Phase = "recording"
	if _, err := a.RestoreBackup(preview.ID, true); err == nil {
		t.Fatal("restored during recording")
	}
	a.status.Phase = "idle"
	if _, err := a.RestoreBackup(preview.ID, true); err != nil {
		t.Fatal(err)
	}
	if a.settings != local || a.pendingBackup != nil {
		t.Fatal("local device state changed or archive remained open")
	}
	if _, err := a.RestoreBackup(preview.ID, true); err == nil {
		t.Fatal("reused consumed preview")
	}
	preview, err = a.previewBackup(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.DiscardBackupPreview(preview.ID); err != nil {
		t.Fatal(err)
	}
	if a.pendingBackup != nil {
		t.Fatal("cancelled preview remained open")
	}
	for _, phase := range []string{"backup", "recording", "transcribing", "downloading", "mic-test", "diagnostic-transcribing", "text-processing"} {
		a.status.Phase = phase
		if _, err := a.previewBackup(path); err == nil {
			t.Fatalf("preview while busy: %s", phase)
		}
		if _, err := a.exportBackup(path, false); err == nil {
			t.Fatalf("export while busy: %s", phase)
		}
	}
	a.status.Phase = "idle"
	a.previewBackup(path)
	a.shutdown(a.ctx)
	if a.pendingBackup != nil {
		t.Fatal("shutdown leaked preview")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal("archive still in use", err)
	}
}

func TestBackupBlocksOtherOperationsAndDeferredDiscard(t *testing.T) {
	a := testApp(t)
	path := filepath.Join(t.TempDir(), "backup.zip")
	if _, err := a.exportBackup(path, false); err != nil {
		t.Fatal(err)
	}
	preview, err := a.previewBackup(path)
	if err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	previous, _, err := a.beginBackupLocked("Checking backup…")
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.StartRecording(); err == nil {
		t.Fatal("recording during backup")
	}
	if err := a.SaveSettings(a.settings); err == nil {
		t.Fatal("settings changed during backup")
	}
	if err := a.DiscardBackupPreview(preview.ID); err != nil {
		t.Fatal(err)
	}
	if a.pendingBackup == nil {
		t.Fatal("closed in-use preview too early")
	}
	a.mu.Lock()
	a.finishBackupLocked(previous)
	a.mu.Unlock()
	a.wg.Done()
	if a.pendingBackup != nil {
		t.Fatal("navigation leaked in-use preview")
	}
}
