package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"
)

type SpeechStats struct {
	TranscriptionMS float64 `json:"transcriptionMs"`
	Engine          string  `json:"engine"`
}

func (s *SpeechStats) Valid() bool {
	return s == nil || (s.TranscriptionMS >= 0 && !math.IsInf(s.TranscriptionMS, 0) && !math.IsNaN(s.TranscriptionMS) && (s.Engine == "whisper" || s.Engine == "parakeet" || s.Engine == "moonshine"))
}

// Side tables preserve the recording/output schemas used by older builds.
const speechStatsColumn = "COALESCE((SELECT value FROM inference_stats WHERE kind='speech' AND id=r.id),'null')"
const textStatsColumn = "COALESCE((SELECT value FROM inference_stats WHERE kind='text' AND id=generated_outputs.id),'null')"

func insertInferenceStats(tx *sql.Tx, kind, id string, stats any) error {
	if v, ok := stats.(interface{ Valid() bool }); !ok || !v.Valid() {
		return errors.New("invalid inference stats")
	}
	data, err := json.Marshal(stats)
	if err != nil || string(data) == "null" {
		return err
	}
	_, err = tx.Exec("INSERT INTO inference_stats(kind,id,value) VALUES(?,?,?)", kind, id, string(data))
	return err
}

func scanSession(row interface{ Scan(...any) error }, v *Session, deleted bool) error {
	var stats string
	args := []any{&v.ID, &v.CreatedAt, &v.DurationMS, &v.RawTranscript, &v.SpeechModel, &v.Language, &v.AudioPath, &v.FinalTranscript}
	if deleted {
		args = append(args, &v.DeletedAt)
	}
	args = append(args, &v.Title, &stats)
	if err := row.Scan(args...); err != nil {
		return err
	}
	return json.Unmarshal([]byte(stats), &v.Stats)
}
