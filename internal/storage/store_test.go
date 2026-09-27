package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPersistenceAndAudioDeletion(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	settings := Defaults()
	settings.Language = "de"
	settings.SaveAudio = true
	settings.MicrophoneID = "persistent-usb-device"
	settings.LaunchAtLogin, settings.StartInTray = true, true
	if err = s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	audio := filepath.Join(dir, "recordings", "one.wav")
	if err = os.WriteFile(audio, []byte("audio"), 0600); err != nil {
		t.Fatal(err)
	}
	v := NewSession("one", 1234, "a private thought", "small", "de", audio)
	if err = s.Add(v); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err := s.Settings()
	if err != nil || got != settings {
		t.Fatalf("settings did not persist: %+v %v", got, err)
	}
	entries, err := s.History()
	if err != nil || len(entries) != 1 || entries[0] != v {
		t.Fatalf("history did not persist: %+v %v", entries, err)
	}
	if err = s.Delete("one"); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(audio); !os.IsNotExist(err) {
		t.Fatal("retained audio was not removed")
	}
	entries, err = s.History()
	if err != nil || len(entries) != 0 {
		t.Fatalf("deleted transcript still exists: %v", err)
	}
}

func TestExistingSettingsKeepSystemDefaultMicrophone(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// A database written before microphone selection must retain its preferences.
	_, err = s.db.Exec(`INSERT INTO settings (id, value) VALUES (1, ?)`, `{"language":"de","shortcut":"Ctrl+Alt+Space","interaction":"toggle","autoPaste":false,"saveAudio":true}`)
	if err != nil {
		t.Fatal(err)
	}
	settings, err := s.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.MicrophoneID != "" || settings.Language != "de" || settings.Interaction != "toggle" || settings.AutoPaste || !settings.SaveAudio {
		t.Fatalf("existing settings were changed: %+v", settings)
	}
	if settings.LaunchAtLogin || settings.StartInTray {
		t.Fatal("existing settings unexpectedly enabled background startup")
	}
}
func TestDeletionDoesNotRemoveExternalFile(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	outside := filepath.Join(t.TempDir(), "important.txt")
	os.WriteFile(outside, []byte("keep"), 0600)
	if err = s.Add(NewSession("external", 1000, "test", "model", "en", outside)); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete("external"); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(outside); err != nil {
		t.Fatal("removed an external file")
	}
}
