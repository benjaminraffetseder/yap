// Package backups owns preview handles and portable backup workflows.
// Its caller serializes state changes and owns operation/lifecycle reservations.
package backups

import (
	"context"
	"errors"

	"yap/internal/storage"

	"github.com/google/uuid"
)

type Service struct {
	archive      *storage.BackupArchive
	id           string
	discardAfter bool
}

// Preview keeps the validated archive separate from published service state
// until the caller checks cancellation under its operation lock.
type Preview struct {
	archive *storage.BackupArchive
	summary storage.BackupSummary
	path    string
}

func Export(ctx context.Context, store *storage.Store, path string, includeAudio bool) (*storage.BackupSummary, error) {
	summary, err := store.ExportBackup(ctx, path, includeAudio)
	if err != nil && ctx.Err() != nil {
		err = errors.New("backup cancelled; no changes were saved")
	}
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

// Inspect returns ownership of any opened archive even when validation fails;
// the caller closes it after releasing its operation reservation.
func Inspect(ctx context.Context, store *storage.Store, path string) (Preview, error) {
	archive, err := storage.ReadBackup(ctx, path)
	preview := Preview{archive: archive, path: path}
	if err == nil {
		preview.summary, err = store.PreviewBackup(ctx, archive)
	}
	return preview, err
}

func (p Preview) Close() error {
	if p.archive != nil {
		return p.archive.Close()
	}
	return nil
}

func (s *Service) Publish(preview Preview) *storage.BackupPreview {
	s.archive, s.id = preview.archive, uuid.NewString()
	result := preview.archive.Preview(preview.summary, preview.path)
	result.ID = s.id
	return &result
}

func (s *Service) HasPreview() bool { return s.archive != nil }

func (s *Service) Archive(id string) (*storage.BackupArchive, error) {
	if id == "" || id != s.id || s.archive == nil {
		return nil, errors.New("select and preview a backup before restoring")
	}
	return s.archive, nil
}

func (s *Service) Discard(id string, operationActive bool) error {
	if id != s.id || s.archive == nil {
		return nil
	}
	if operationActive {
		s.discardAfter = true
		return nil
	}
	return s.Close()
}

func (s *Service) Finish() {
	if s.discardAfter {
		_ = s.Close()
	}
	s.discardAfter = false
}

func (s *Service) Close() error {
	var err error
	if s.archive != nil {
		err = s.archive.Close()
	}
	s.archive, s.id = nil, ""
	return err
}

func Restore(ctx context.Context, store *storage.Store, archive *storage.BackupArchive, preferences bool) (storage.RestoredBackup, error) {
	result, err := store.RestoreBackup(ctx, archive, preferences)
	if err != nil && ctx.Err() != nil {
		err = errors.New("restore cancelled; no changes were saved")
	}
	return result, err
}

// PortableSettings preserves machine-specific values already reconciled at startup.
func PortableSettings(local, restored storage.Settings) storage.Settings {
	local.Language, local.Interaction, local.AutoPaste, local.SaveAudio, local.CleanText = restored.Language, restored.Interaction, restored.AutoPaste, restored.SaveAudio, restored.CleanText
	local.AutoCopy, local.SaveHistory = restored.AutoCopy, restored.SaveHistory
	return local
}
