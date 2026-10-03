package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
	"yap/internal/vocabulary"

	_ "modernc.org/sqlite"
)

type Settings struct {
	MicrophoneID         string `json:"microphoneId"`
	WhisperPath          string `json:"whisperPath"`
	ModelPath            string `json:"modelPath"`
	Language             string `json:"language"`
	Shortcut             string `json:"shortcut"`
	Interaction          string `json:"interaction"`
	AutoPaste            bool   `json:"autoPaste"`
	SaveAudio            bool   `json:"saveAudio"`
	LaunchAtLogin        bool   `json:"launchAtLogin"`
	StartInTray          bool   `json:"startInTray"`
	CleanText            bool   `json:"cleanText"`
	SetupComplete        bool   `json:"setupComplete"`
	HistoryRetentionDays int    `json:"historyRetentionDays"`
}

func Defaults() Settings {
	return Settings{Language: "auto", Shortcut: "Ctrl+Alt+Space", Interaction: "hold", AutoPaste: true}
}

type Session struct {
	ID              string `json:"id"`
	CreatedAt       string `json:"createdAt"`
	DurationMS      int64  `json:"durationMs"`
	RawTranscript   string `json:"rawTranscript"`
	FinalTranscript string `json:"finalTranscript"`
	SpeechModel     string `json:"speechModel"`
	Language        string `json:"language"`
	AudioPath       string `json:"audioPath"`
}

type Store struct {
	db  *sql.DB
	Dir string
}

func Open(dir string) (*Store, error) {
	for _, name := range []string{"", "recordings", "models", "runtime", "exports"} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0700); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "database.sqlite"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
	CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, transcript TEXT NOT NULL, model TEXT NOT NULL, language TEXT NOT NULL, audio_path TEXT NOT NULL);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	// Expand storage without changing the original table's columns. Older builds
	// still insert/read recordings normally; their deletes also run this trigger.
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS vocabulary (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS recording_outputs (id TEXT PRIMARY KEY, transcript TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS text_processing (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS pending_audio_deletions (id TEXT PRIMARY KEY, original TEXT NOT NULL, staged TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS discarded_audio (path TEXT PRIMARY KEY);
	CREATE TRIGGER IF NOT EXISTS delete_recording_output AFTER DELETE ON recordings BEGIN DELETE FROM recording_outputs WHERE id=OLD.id; END;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS generated_outputs (
		id TEXT PRIMARY KEY, recording_id TEXT NOT NULL, created_at TEXT NOT NULL,
		prompt_id TEXT NOT NULL, prompt_name TEXT NOT NULL, instruction TEXT NOT NULL,
		model TEXT NOT NULL, endpoint TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL);
	CREATE INDEX IF NOT EXISTS generated_outputs_recording ON generated_outputs(recording_id,created_at);
	CREATE TRIGGER IF NOT EXISTS delete_generated_outputs AFTER DELETE ON recordings
	BEGIN DELETE FROM generated_outputs WHERE recording_id=OLD.id; END;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, Dir: dir}, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Settings() (Settings, error) {
	out := Defaults()
	var raw string
	err := s.db.QueryRow("SELECT value FROM settings WHERE id=1").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal([]byte(raw), &out)
	if err == nil {
		var fields map[string]json.RawMessage
		_ = json.Unmarshal([]byte(raw), &fields)
		if _, exists := fields["setupComplete"]; !exists {
			out.SetupComplete = out.WhisperPath != "" && out.ModelPath != ""
		}
	}
	return out, err
}
func (s *Store) SaveSettings(v Settings) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", string(data))
	return err
}
func (s *Store) Add(v Session) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec("INSERT INTO recordings VALUES(?,?,?,?,?,?,?)", v.ID, v.CreatedAt, v.DurationMS, v.RawTranscript, v.SpeechModel, v.Language, v.AudioPath)
	if err != nil {
		return err
	}
	if v.FinalTranscript != "" && v.FinalTranscript != v.RawTranscript {
		if _, err := tx.Exec("INSERT INTO recording_outputs VALUES(?,?)", v.ID, v.FinalTranscript); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) History() ([]Session, error) {
	rows, err := s.db.Query("SELECT r.id,r.created_at,r.duration_ms,r.transcript,r.model,r.language,r.audio_path,COALESCE(o.transcript,r.transcript) FROM recordings r LEFT JOIN recording_outputs o ON r.id=o.id ORDER BY r.created_at COLLATE yap_datetime DESC,r.id DESC LIMIT 500")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var v Session
		if err = rows.Scan(&v.ID, &v.CreatedAt, &v.DurationMS, &v.RawTranscript, &v.SpeechModel, &v.Language, &v.AudioPath, &v.FinalTranscript); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) Session(id string) (Session, error) {
	var v Session
	err := s.db.QueryRow("SELECT r.id,r.created_at,r.duration_ms,r.transcript,r.model,r.language,r.audio_path,COALESCE(o.transcript,r.transcript) FROM recordings r LEFT JOIN recording_outputs o ON r.id=o.id WHERE r.id=?", id).Scan(&v.ID, &v.CreatedAt, &v.DurationMS, &v.RawTranscript, &v.SpeechModel, &v.Language, &v.AudioPath, &v.FinalTranscript)
	return v, err
}

// Corrections share the processed-text table; raw recognition and recording
// metadata remain immutable. The INSERT selects only an existing recording so
// deleting a session cannot leave an orphaned correction.
func (s *Store) UpdateTranscript(id, text string) error {
	if strings.TrimSpace(text) == "" {
		return errors.New("enter a transcript before saving")
	}
	if !utf8.ValidString(text) || strings.ContainsRune(text, 0) {
		return errors.New("transcript must contain valid text without null characters")
	}
	if utf8.RuneCountInString(text) > 100000 {
		return errors.New("use at most 100,000 characters in a transcript")
	}
	result, err := s.db.Exec(`INSERT INTO recording_outputs(id,transcript)
		SELECT id,? FROM recordings WHERE id=?
		ON CONFLICT(id) DO UPDATE SET transcript=excluded.transcript`, text, id)
	if err != nil {
		return fmt.Errorf("could not save transcript: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return errors.New("this dictation no longer exists; close the editor and refresh History")
	}
	return nil
}
func NewSession(id string, duration int64, text, model, language, path string) Session {
	return Session{ID: id, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), DurationMS: duration, RawTranscript: text, FinalTranscript: text, SpeechModel: model, Language: language, AudioPath: path}
}

func (s *Store) Vocabulary() ([]vocabulary.Entry, error) {
	out := []vocabulary.Entry{}
	var raw string
	err := s.db.QueryRow("SELECT value FROM vocabulary WHERE id=1").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal([]byte(raw), &out)
	if out == nil {
		out = []vocabulary.Entry{}
	}
	return out, err
}
func (s *Store) SaveVocabulary(entries []vocabulary.Entry) error {
	data, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO vocabulary VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", string(data))
	return err
}
