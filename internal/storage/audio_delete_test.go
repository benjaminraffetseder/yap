package storage

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
)

func retainedSession(t *testing.T, s *Store) Session {
	t.Helper()
	path := filepath.Join(s.Dir, "recordings", "retained.wav")
	if err := os.WriteFile(path, []byte("retained audio"), 0600); err != nil {
		t.Fatal(err)
	}
	v := NewSession("retained", 1000, "Original", "base", "en", path)
	v.FinalTranscript = "Edited"
	if err := s.Add(v); err != nil {
		t.Fatal(err)
	}
	return v
}
func assertRetained(t *testing.T, s *Store, v Session) {
	t.Helper()
	got, err := s.Session(v.ID)
	if err != nil || got != v {
		t.Fatalf("changed session: %+v %v", got, err)
	}
	data, err := os.ReadFile(v.AudioPath)
	if err != nil || string(data) != "retained audio" {
		t.Fatalf("lost audio: %q %v", data, err)
	}
}

func TestDeleteDatabaseBusyPreservesRetainedAudioAndRetries(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	v := retainedSession(t, s)
	s.db.Exec("PRAGMA busy_timeout=10")
	other, err := sql.Open("sqlite", filepath.Join(s.Dir, "database.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	conn, err := other.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err = conn.ExecContext(context.Background(), "BEGIN IMMEDIATE"); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(v.ID); err == nil {
		t.Fatal("ignored database lock")
	}
	assertRetained(t, s, v)
	if _, err = conn.ExecContext(context.Background(), "ROLLBACK"); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(v.ID); err != nil {
		t.Fatal("retry failed", err)
	}
	if _, err = s.Session(v.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("row survived", err)
	}
	if _, err = os.Stat(v.AudioPath); !os.IsNotExist(err) {
		t.Fatal("audio survived", err)
	}
}

func TestFailedCommitRestoresStagedAudioAndTranscript(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	v := retainedSession(t, s)
	// Deferred FK rejection occurs only after DELETE and audio staging, at COMMIT.
	_, err = s.db.Exec(`PRAGMA foreign_keys=ON; CREATE TABLE keep_recording (id TEXT REFERENCES recordings(id) DEFERRABLE INITIALLY DEFERRED); INSERT INTO keep_recording VALUES('retained');`)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(v.ID); err == nil {
		t.Fatal("expected deferred commit failure")
	}
	assertRetained(t, s, v)
	var pending int
	if err = s.db.QueryRow("SELECT count(*) FROM pending_audio_deletions").Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("recovery journal leaked: %d %v", pending, err)
	}
	s.db.Exec("DELETE FROM keep_recording")
	if err = s.Delete(v.ID); err != nil {
		t.Fatal("could not retry after commit failure", err)
	}
}

func TestPendingAudioRecoveryAcrossRestartWithoutRetention(t *testing.T) {
	for _, committed := range []bool{false, true} {
		t.Run(map[bool]string{false: "rollback", true: "finish"}[committed], func(t *testing.T) {
			dir := t.TempDir()
			s, err := Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			v := retainedSession(t, s)
			stage := filepath.Join(dir, "recordings", ".pending-delete-"+uuid.NewString())
			if _, err = s.db.Exec("INSERT INTO pending_audio_deletions VALUES(?,?,?)", v.ID, v.AudioPath, stage); err != nil {
				t.Fatal(err)
			}
			if err = os.Rename(v.AudioPath, stage); err != nil {
				t.Fatal(err)
			}
			if committed {
				if _, err = s.db.Exec("DELETE FROM recordings WHERE id=?", v.ID); err != nil {
					t.Fatal(err)
				}
			}
			s.Close()
			s, err = Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if _, err = s.PruneHistory(0, time.Now()); err != nil {
				t.Fatal(err)
			}
			if !committed {
				assertRetained(t, s, v)
			} else {
				if _, err = s.Session(v.ID); !errors.Is(err, sql.ErrNoRows) {
					t.Fatal(err)
				}
			}
			if _, err = os.Stat(stage); !os.IsNotExist(err) {
				t.Fatal("staged file survived recovery", err)
			}
			if err = s.RecoverPendingDeletes(); err != nil {
				t.Fatal("recovery not idempotent", err)
			}
		})
	}
}

func TestPendingDeletionDoesNotTouchExternalFiles(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	outside := filepath.Join(t.TempDir(), ".pending-delete-"+uuid.NewString())
	os.WriteFile(outside, []byte("keep"), 0600)
	s.db.Exec("INSERT INTO pending_audio_deletions VALUES(?,?,?)", "bad", filepath.Join(s.Dir, "recordings", "bad.wav"), outside)
	if err = s.RecoverPendingDeletes(); err == nil {
		t.Fatal("external staged path accepted")
	}
	if data, err := os.ReadFile(outside); err != nil || string(data) != "keep" {
		t.Fatal("external file changed")
	}
}
