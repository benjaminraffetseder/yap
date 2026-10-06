package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestModelInstallRejectsUnavailableCustomRuntime(t *testing.T) {
	a := testApp(t)
	selected := filepath.Join(a.store.Dir, "custom-missing-whisper")
	a.settings.WhisperPath = selected
	previous := a.settings.ModelPath
	if err := a.InstallModel("tiny"); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	if a.status.Phase != "error" || strings.Contains(a.status.Message, "Ready to dictate") {
		t.Fatal("unavailable runtime reported ready", a.status)
	}
	if a.settings.WhisperPath != selected || a.settings.ModelPath != previous {
		t.Fatal("failed custom validation changed selections")
	}
}
