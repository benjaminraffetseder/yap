package storage

import (
	"errors"
	"time"

	"github.com/google/uuid"
	textmodel "yap/internal/inference/text"
)

type GeneratedOutput struct {
	ID        string           `json:"id"`
	SessionID string           `json:"sessionId"`
	CreatedAt string           `json:"createdAt"`
	Prompt    textmodel.Prompt `json:"prompt"`
	Model     string           `json:"model"`
	Endpoint  string           `json:"endpoint"`
	Input     string           `json:"input"`
	Text      string           `json:"text"`
}

func NewGeneratedOutput(sessionID, input, output string, config textmodel.Config, prompt textmodel.Prompt) GeneratedOutput {
	// Fixed fractional precision keeps SQLite's text ordering chronological.
	return GeneratedOutput{ID: uuid.NewString(), SessionID: sessionID, CreatedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z"), Prompt: prompt, Model: config.Model, Endpoint: config.Endpoint, Input: input, Text: output}
}

func (s *Store) AddGeneratedOutput(v GeneratedOutput) error {
	if err := textmodel.ValidateText(v.Input); err != nil {
		return err
	}
	if err := textmodel.ValidateText(v.Text); err != nil {
		return err
	}
	if _, err := textmodel.Normalize(textmodel.Config{Enabled: true, Endpoint: v.Endpoint, Model: v.Model, Prompts: []textmodel.Prompt{v.Prompt}}); err != nil {
		return err
	}
	if v.ID == "" || v.SessionID == "" {
		return errors.New("invalid generated output")
	}
	if _, err := time.Parse(time.RFC3339Nano, v.CreatedAt); err != nil {
		return errors.New("invalid output creation time")
	}
	// Parent existence and insertion are one statement: deletion during inference
	// cannot create an orphan, and duplicate output IDs never overwrite a version.
	result, err := s.db.Exec(`INSERT INTO generated_outputs
		SELECT ?,id,?,?,?,?,?,?,?,? FROM recordings WHERE id=?`,
		v.ID, v.CreatedAt, v.Prompt.ID, v.Prompt.Name, v.Prompt.Instruction, v.Model, v.Endpoint, v.Input, v.Text, v.SessionID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count == 0 {
		return errors.New("this dictation no longer exists; the output was not saved")
	}
	return err
}

const generatedOutputColumns = "id,recording_id,created_at,prompt_id,prompt_name,instruction,model,endpoint,input,output"

func (s *Store) GeneratedOutputs(sessionID string) ([]GeneratedOutput, error) {
	rows, err := s.db.Query("SELECT "+generatedOutputColumns+" FROM generated_outputs WHERE recording_id=? ORDER BY created_at DESC,id DESC", sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	outputs := []GeneratedOutput{}
	for rows.Next() {
		var v GeneratedOutput
		if err := rows.Scan(&v.ID, &v.SessionID, &v.CreatedAt, &v.Prompt.ID, &v.Prompt.Name, &v.Prompt.Instruction, &v.Model, &v.Endpoint, &v.Input, &v.Text); err != nil {
			return nil, err
		}
		outputs = append(outputs, v)
	}
	return outputs, rows.Err()
}

func (s *Store) GeneratedOutput(sessionID, outputID string) (GeneratedOutput, error) {
	var v GeneratedOutput
	err := s.db.QueryRow("SELECT "+generatedOutputColumns+" FROM generated_outputs WHERE recording_id=? AND id=?", sessionID, outputID).Scan(&v.ID, &v.SessionID, &v.CreatedAt, &v.Prompt.ID, &v.Prompt.Name, &v.Prompt.Instruction, &v.Model, &v.Endpoint, &v.Input, &v.Text)
	return v, err
}

func (s *Store) DeleteGeneratedOutput(sessionID, outputID string) error {
	_, err := s.db.Exec("DELETE FROM generated_outputs WHERE recording_id=? AND id=?", sessionID, outputID)
	return err
}
