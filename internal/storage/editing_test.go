package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTranscriptEditsPreserveOriginalMetadataAndAudio(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	audio := filepath.Join(dir, "recordings", "one.wav")
	if err := os.WriteFile(audio, []byte("keep recording"), 0600); err != nil {
		t.Fatal(err)
	}
	original := NewSession("one", 1234, "um, hello", "small", "en", audio)
	original.FinalTranscript = "Hello."
	if err := s.Add(original); err != nil {
		t.Fatal(err)
	}
	text := "  Corrected name: PostgreSQL.\nSecond paragraph.  "
	for i := 0; i < 2; i++ {
		if err := s.UpdateTranscript(original.ID, text); err != nil {
			t.Fatal(err)
		}
	}
	s.Close()
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	want := original
	want.FinalTranscript = text
	got, err := s.Session(original.ID)
	if err != nil || got != want {
		t.Fatalf("edited session lost data: %+v %v", got, err)
	}
	history, err := s.History()
	if err != nil || len(history) != 1 || history[0] != want {
		t.Fatalf("edited history mismatch: %+v %v", history, err)
	}
	data, err := os.ReadFile(audio)
	if err != nil || string(data) != "keep recording" {
		t.Fatal("editing changed audio")
	}
	var raw string
	if err := s.db.QueryRow(`SELECT transcript FROM recordings WHERE id=?`, original.ID).Scan(&raw); err != nil || raw != original.RawTranscript {
		t.Fatal("original transcript rewritten")
	}
	if err := s.UpdateTranscript(original.ID, original.RawTranscript); err != nil {
		t.Fatal(err)
	}
	got, err = s.Session(original.ID)
	if err != nil || got.RawTranscript != original.RawTranscript || got.FinalTranscript != original.RawTranscript {
		t.Fatal("could not restore original text")
	}
	if err := s.Delete(original.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateTranscript(original.ID, "deleted correction"); err == nil {
		t.Fatal("edited deleted session")
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM recording_outputs`).Scan(&count); err != nil || count != 0 {
		t.Fatal("orphaned edited transcript")
	}
}

func TestEditingLegacySessionAndValidation(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.db.Exec(`INSERT INTO recordings VALUES('legacy','2020-01-01',1000,'original','base','en','')`); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateTranscript("legacy", "Corrected."); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"", " \n\t", strings.Repeat("界", 100001), "null\x00text", string([]byte{0xff})} {
		if err := s.UpdateTranscript("legacy", text); err == nil {
			t.Fatal("invalid correction accepted")
		}
		got, err := s.Session("legacy")
		if err != nil || got.RawTranscript != "original" || got.FinalTranscript != "Corrected." {
			t.Fatal("invalid edit changed saved text")
		}
	}
	if err := s.UpdateTranscript("missing", "new entry"); err == nil {
		t.Fatal("created a recording from an edit")
	}
	if err := s.UpdateTranscript("legacy", strings.Repeat("界", 100000)); err != nil {
		t.Fatal("valid Unicode text rejected")
	}
}
