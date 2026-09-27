package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Settings struct {
	MicrophoneID  string `json:"microphoneId"`
	WhisperPath   string `json:"whisperPath"`
	ModelPath     string `json:"modelPath"`
	Language      string `json:"language"`
	Shortcut      string `json:"shortcut"`
	Interaction   string `json:"interaction"`
	AutoPaste     bool   `json:"autoPaste"`
	SaveAudio     bool   `json:"saveAudio"`
	LaunchAtLogin bool   `json:"launchAtLogin"`
	StartInTray   bool   `json:"startInTray"`
}

func Defaults() Settings {
	return Settings{Language: "auto", Shortcut: "Ctrl+Alt+Space", Interaction: "hold", AutoPaste: true}
}

type Session struct {
	ID            string `json:"id"`
	CreatedAt     string `json:"createdAt"`
	DurationMS    int64  `json:"durationMs"`
	RawTranscript string `json:"rawTranscript"`
	SpeechModel   string `json:"speechModel"`
	Language      string `json:"language"`
	AudioPath     string `json:"audioPath"`
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
	_, err := s.db.Exec("INSERT INTO recordings VALUES(?,?,?,?,?,?,?)", v.ID, v.CreatedAt, v.DurationMS, v.RawTranscript, v.SpeechModel, v.Language, v.AudioPath)
	return err
}
func (s *Store) History() ([]Session, error) {
	rows, err := s.db.Query("SELECT id,created_at,duration_ms,transcript,model,language,audio_path FROM recordings ORDER BY created_at DESC LIMIT 500")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var v Session
		if err = rows.Scan(&v.ID, &v.CreatedAt, &v.DurationMS, &v.RawTranscript, &v.SpeechModel, &v.Language, &v.AudioPath); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) Session(id string) (Session, error) {
	var v Session
	err := s.db.QueryRow("SELECT id,created_at,duration_ms,transcript,model,language,audio_path FROM recordings WHERE id=?", id).Scan(&v.ID, &v.CreatedAt, &v.DurationMS, &v.RawTranscript, &v.SpeechModel, &v.Language, &v.AudioPath)
	return v, err
}
func (s *Store) Delete(id string) error {
	v, err := s.Session(id)
	if err != nil {
		return err
	}
	// Only delete audio owned by the application, even if the database is modified.
	if v.AudioPath != "" && filepath.Dir(v.AudioPath) == filepath.Join(s.Dir, "recordings") {
		if err = os.Remove(v.AudioPath); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	_, err = s.db.Exec("DELETE FROM recordings WHERE id=?", id)
	return err
}
func NewSession(id string, duration int64, text, model, language, path string) Session {
	return Session{ID: id, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), DurationMS: duration, RawTranscript: text, SpeechModel: model, Language: language, AudioPath: path}
}
