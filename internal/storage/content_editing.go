package storage

import (
	"database/sql"
	"errors"
	"time"

	textmodel "yap/internal/inference/text"
)

// ErrContentChanged rejects a save based on text that is no longer current.
var ErrContentChanged = errors.New("this content changed; reload the latest text before saving again")

// UpdateGeneratedOutput edits an existing output in place. Its generation row
// remains immutable; the overlay, comparison and revision are one transaction.
func (s *Store) UpdateGeneratedOutput(sessionID, outputID, text, expectedText string) (GeneratedOutput, error) {
	if err := textmodel.ValidateText(text); err != nil {
		return GeneratedOutput{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return GeneratedOutput{}, err
	}
	defer tx.Rollback()
	var output GeneratedOutput
	err = scanGeneratedOutput(tx.QueryRow("SELECT "+generatedOutputColumns+" FROM generated_outputs WHERE recording_id=? AND id=? AND NOT EXISTS (SELECT 1 FROM deleted_recordings d WHERE d.id=generated_outputs.recording_id)", sessionID, outputID), &output)
	if errors.Is(err, sql.ErrNoRows) {
		return GeneratedOutput{}, errors.New("this output no longer exists; close the editor and refresh History")
	}
	if err != nil {
		return GeneratedOutput{}, err
	}
	if output.Text != expectedText {
		return GeneratedOutput{}, ErrContentChanged
	}
	if output.Text != text {
		if err := recordRevision(tx, "output", outputID, output.Text, text, time.Now()); err != nil {
			return GeneratedOutput{}, err
		}
		if text == output.OriginalText {
			_, err = tx.Exec("DELETE FROM generated_output_edits WHERE output_id=?", outputID)
		} else {
			_, err = tx.Exec("INSERT INTO generated_output_edits(output_id,output) VALUES(?,?) ON CONFLICT(output_id) DO UPDATE SET output=excluded.output", outputID, text)
		}
		if err != nil {
			return GeneratedOutput{}, err
		}
		output.Text, output.Edited = text, text != output.OriginalText
	}
	if err := tx.Commit(); err != nil {
		return GeneratedOutput{}, err
	}
	return output, nil
}
