package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	textmodel "yap/internal/inference/text"
)

// OutputChain describes the immutable inputs used by a step in one chain run.
type OutputChain struct {
	RunID          string `json:"runId"`
	ChainID        string `json:"chainId"`
	Name           string `json:"name"`
	StepID         string `json:"stepId"`
	Step           int    `json:"step"`
	Total          int    `json:"total"`
	Input          string `json:"input"`
	SourceOutputID string `json:"sourceOutputId"`
}

type GeneratedOutput struct {
	ID        string           `json:"id"`
	SessionID string           `json:"sessionId"`
	CreatedAt string           `json:"createdAt"`
	Prompt    textmodel.Prompt `json:"prompt"`
	Model     string           `json:"model"`
	Endpoint  string           `json:"endpoint"`
	Input     string           `json:"input"`
	Text      string           `json:"text"`
	Chain     OutputChain      `json:"chain"`
}

func NewGeneratedOutput(sessionID, input, output string, config textmodel.Config, prompt textmodel.Prompt) GeneratedOutput {
	// Fixed fractional precision keeps SQLite's text ordering chronological.
	return GeneratedOutput{ID: uuid.NewString(), SessionID: sessionID, CreatedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z"), Prompt: prompt, Model: config.Model, Endpoint: config.Endpoint, Input: input, Text: output}
}

func (s *Store) AddGeneratedOutput(v GeneratedOutput) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := insertGeneratedOutput(tx, v); err != nil {
		return err
	}
	return tx.Commit()
}

func validateOutputChain(v OutputChain) error {
	if v == (OutputChain{}) {
		return nil
	}
	for _, id := range []string{v.RunID, v.ChainID, v.StepID} {
		if id == "" || !validBackupString(id, 80) || strings.ContainsAny(id, "\r\n") {
			return errors.New("invalid chain output reference")
		}
	}
	if v.Name == "" || !validBackupString(v.Name, 80) || v.Step < 1 || v.Step > v.Total || v.Total > 10 || !validBackupString(v.SourceOutputID, 80) {
		return errors.New("invalid chain output details")
	}
	if v.Input != "original" && v.Input != "transcript" && (!strings.HasPrefix(v.Input, "step:") || !validBackupString(v.Input, 85) || v.SourceOutputID == "") {
		return errors.New("invalid chain output input")
	}
	return nil
}

func insertGeneratedOutput(tx *sql.Tx, v GeneratedOutput) error {
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
	if err := validateOutputChain(v.Chain); err != nil {
		return err
	}
	// Parent existence and insertion are one statement: deletion during inference
	// cannot create an orphan, and duplicate output IDs never overwrite a version.
	result, err := tx.Exec(`INSERT INTO generated_outputs
		SELECT ?,id,?,?,?,?,?,?,?,? FROM recordings WHERE id=?`,
		v.ID, v.CreatedAt, v.Prompt.ID, v.Prompt.Name, v.Prompt.Instruction, v.Model, v.Endpoint, v.Input, v.Text, v.SessionID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count == 0 {
		return errors.New("this dictation no longer exists; the output was not saved")
	}
	if err != nil || v.Chain.RunID == "" {
		return err
	}
	data, err := json.Marshal(v.Chain)
	if err != nil {
		return err
	}
	_, err = tx.Exec("INSERT INTO generated_output_chains(output_id,value) VALUES(?,?)", v.ID, string(data))
	return err
}

const generatedOutputColumns = "id,recording_id,created_at,prompt_id,prompt_name,instruction,model,endpoint,input,output,COALESCE((SELECT value FROM generated_output_chains WHERE output_id=generated_outputs.id),'{}')"

func scanGeneratedOutput(row interface{ Scan(...any) error }, v *GeneratedOutput) error {
	var chain string
	if err := row.Scan(&v.ID, &v.SessionID, &v.CreatedAt, &v.Prompt.ID, &v.Prompt.Name, &v.Prompt.Instruction, &v.Model, &v.Endpoint, &v.Input, &v.Text, &chain); err != nil {
		return err
	}
	return json.Unmarshal([]byte(chain), &v.Chain)
}

func (s *Store) GeneratedOutputs(sessionID string) ([]GeneratedOutput, error) {
	rows, err := s.db.Query("SELECT "+generatedOutputColumns+" FROM generated_outputs WHERE recording_id=? ORDER BY created_at COLLATE yap_datetime DESC,id DESC", sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	outputs := []GeneratedOutput{}
	for rows.Next() {
		var v GeneratedOutput
		if err := scanGeneratedOutput(rows, &v); err != nil {
			return nil, err
		}
		outputs = append(outputs, v)
	}
	return outputs, rows.Err()
}

func (s *Store) GeneratedOutput(sessionID, outputID string) (GeneratedOutput, error) {
	var v GeneratedOutput
	err := scanGeneratedOutput(s.db.QueryRow("SELECT "+generatedOutputColumns+" FROM generated_outputs WHERE recording_id=? AND id=?", sessionID, outputID), &v)
	return v, err
}

func (s *Store) DeleteGeneratedOutput(sessionID, outputID string) error {
	_, err := s.db.Exec("DELETE FROM generated_outputs WHERE recording_id=? AND id=?", sessionID, outputID)
	return err
}
