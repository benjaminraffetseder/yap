package storage

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	textmodel "yap/internal/inference/text"
	"yap/internal/vocabulary"
)

const backupVersion = 1
const maxBackupBytes int64 = 2 << 30
const maxManifestBytes int64 = 64 << 20
const maxBackupAudioBytes int64 = 20 << 20
const maxBackupEntries = 100000

// Only portable preferences cross computers. Startup, shortcuts, devices,
// runtime/model paths, server configuration, setup and retention stay local.
type BackupPreferences struct {
	Language    string `json:"language"`
	Interaction string `json:"interaction"`
	AutoPaste   bool   `json:"autoPaste"`
	SaveAudio   bool   `json:"saveAudio"`
	CleanText   bool   `json:"cleanText"`
}

type backupManifest struct {
	Format      string             `json:"format"`
	Version     int                `json:"version"`
	CreatedAt   string             `json:"createdAt"`
	Preferences BackupPreferences  `json:"preferences"`
	Sessions    []Session          `json:"sessions"`
	Outputs     []GeneratedOutput  `json:"outputs"`
	Prompts     []textmodel.Prompt `json:"prompts"`
	Vocabulary  []vocabulary.Entry `json:"vocabulary"`
}

type BackupSummary struct {
	Sessions          int `json:"sessions"`
	DuplicateSessions int `json:"duplicateSessions"`
	Outputs           int `json:"outputs"`
	DuplicateOutputs  int `json:"duplicateOutputs"`
	Prompts           int `json:"prompts"`
	SkippedPrompts    int `json:"skippedPrompts"`
	Vocabulary        int `json:"vocabulary"`
	SkippedVocabulary int `json:"skippedVocabulary"`
	Recordings        int `json:"recordings"`
	MissingRecordings int `json:"missingRecordings"`
}

type BackupPreview struct {
	ID          string            `json:"id"`
	Filename    string            `json:"filename"`
	CreatedAt   string            `json:"createdAt"`
	Preferences BackupPreferences `json:"preferences"`
	Summary     BackupSummary     `json:"summary"`
}

// The open archive and validated manifest never come from the webview.
// Audio hashes bind restored bytes to the preview even if the source changes.
type BackupArchive struct {
	reader   *zip.Reader
	file     *os.File
	manifest backupManifest
	audio    map[string]*zip.File
	hashes   map[string][32]byte
}

func (b *BackupArchive) Close() error { return b.file.Close() }
func (b *BackupArchive) Preview(summary BackupSummary, filename string) BackupPreview {
	return BackupPreview{Filename: filepath.Base(filename), CreatedAt: b.manifest.CreatedAt, Preferences: b.manifest.Preferences, Summary: summary}
}

func archiveAudioName(id string) string {
	return fmt.Sprintf("audio/%x.wav", sha256.Sum256([]byte(id)))
}

func (s *Store) recordingRoot() (*os.Root, error) {
	resolved, err := filepath.EvalSymlinks(filepath.Join(s.Dir, "recordings"))
	base, baseErr := filepath.EvalSymlinks(s.Dir)
	if err != nil || baseErr != nil || resolved != filepath.Join(base, "recordings") {
		return nil, errors.New("recording storage is redirected or unavailable")
	}
	return os.OpenRoot(resolved)
}

func readBackupValue(ctx context.Context, tx *sql.Tx, table string, value any) error {
	var raw string
	err := tx.QueryRowContext(ctx, "SELECT value FROM "+table+" WHERE id=1").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(raw), value); err != nil {
		return err
	}
	if settings, ok := value.(*Settings); ok {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &fields); err != nil {
			return err
		}
		if _, present := fields["setupComplete"]; !present {
			settings.SetupComplete = settings.WhisperPath != "" && settings.ModelPath != ""
		}
	}
	return nil
}

func backupSnapshot(ctx context.Context, tx *sql.Tx) (backupManifest, error) {
	return backupSnapshotBounded(ctx, tx, maxManifestBytes)
}

func backupSnapshotBounded(ctx context.Context, tx *sql.Tx, limit int64) (backupManifest, error) {
	m := backupManifest{Format: "yap-backup", Version: backupVersion, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sessions: []Session{}, Outputs: []GeneratedOutput{}, Vocabulary: []vocabulary.Entry{}}
	settings, config := Defaults(), textmodel.Defaults()
	if err := readBackupValue(ctx, tx, "settings", &settings); err != nil {
		return m, err
	}
	if err := readBackupValue(ctx, tx, "text_processing", &config); err != nil {
		return m, err
	}
	if err := readBackupValue(ctx, tx, "vocabulary", &m.Vocabulary); err != nil {
		return m, err
	}
	m.Preferences = BackupPreferences{settings.Language, settings.Interaction, settings.AutoPaste, settings.SaveAudio, settings.CleanText}
	m.Prompts = config.Prompts
	base, err := json.Marshal(m)
	if err != nil {
		return m, err
	}
	used := int64(len(base))
	if used > limit {
		return m, errors.New("backup metadata exceeds 64 MiB")
	}
	account := func(value any, previous int) error {
		encoded, err := json.Marshal(value)
		if err != nil {
			return err
		}
		size := int64(len(encoded))
		if previous > 0 {
			size++
		}
		if size > limit-used {
			return errors.New("backup metadata exceeds 64 MiB")
		}
		used += size
		return nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT r.id,r.created_at,r.duration_ms,r.transcript,r.model,r.language,r.audio_path,COALESCE(o.transcript,r.transcript) FROM recordings r LEFT JOIN recording_outputs o ON r.id=o.id ORDER BY r.created_at COLLATE yap_datetime DESC,r.id DESC`)
	if err != nil {
		return m, err
	}
	for rows.Next() {
		var v Session
		if err = rows.Scan(&v.ID, &v.CreatedAt, &v.DurationMS, &v.RawTranscript, &v.SpeechModel, &v.Language, &v.AudioPath, &v.FinalTranscript); err != nil {
			break
		}
		budgetValue := v
		// Audio names may lengthen during export. Account for the larger encoding
		// before retaining rows or touching audio; missing/unselected audio shrinks it.
		if v.AudioPath != "" {
			archived := archiveAudioName(v.ID)
			originalJSON, _ := json.Marshal(v.AudioPath)
			archivedJSON, _ := json.Marshal(archived)
			if len(archivedJSON) > len(originalJSON) {
				budgetValue.AudioPath = archived
			}
		}
		if err = account(budgetValue, len(m.Sessions)); err != nil {
			break
		}
		m.Sessions = append(m.Sessions, v)
		if len(m.Sessions) > maxBackupEntries {
			err = errors.New("too many dictations for one backup")
			break
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return m, err
	}
	rows, err = tx.QueryContext(ctx, "SELECT "+generatedOutputColumns+" FROM generated_outputs ORDER BY created_at COLLATE yap_datetime,id")
	if err != nil {
		return m, err
	}
	for rows.Next() {
		var v GeneratedOutput
		if err = rows.Scan(&v.ID, &v.SessionID, &v.CreatedAt, &v.Prompt.ID, &v.Prompt.Name, &v.Prompt.Instruction, &v.Model, &v.Endpoint, &v.Input, &v.Text); err != nil {
			break
		}
		if err = account(v, len(m.Outputs)); err != nil {
			break
		}
		m.Outputs = append(m.Outputs, v)
		if len(m.Outputs) > maxBackupEntries {
			err = errors.New("too many generated outputs for one backup")
			break
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	return m, err
}

// Exports all History, not the UI's recent snapshot or paginated selection.
// A failed export never replaces a previously saved backup.
func (s *Store) ExportBackup(ctx context.Context, path string, includeAudio bool) (summary BackupSummary, err error) {
	dataDir, err := filepath.EvalSymlinks(s.Dir)
	if err != nil {
		return summary, err
	}
	destinationDir, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return summary, err
	}
	dataDir, err = filepath.Abs(dataDir)
	if err != nil {
		return summary, err
	}
	destinationDir, err = filepath.Abs(destinationDir)
	if err != nil {
		return summary, err
	}
	if rel, e := filepath.Rel(dataDir, filepath.Join(destinationDir, filepath.Base(path))); e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return summary, errors.New("save the backup outside Yap's data folder")
	}
	if err = s.RecoverPendingDeletes(); err != nil {
		return summary, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return summary, err
	}
	defer tx.Rollback()
	m, err := backupSnapshot(ctx, tx)
	if err != nil {
		return summary, err
	}
	// The manifest is now independent of SQLite; don't hold its only connection
	// while compressing recordings. The app blocks history changes during export.
	if err = tx.Rollback(); err != nil {
		return summary, err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".yap-backup-*.tmp")
	if err != nil {
		return summary, err
	}
	defer func() { file.Close(); os.Remove(file.Name()) }()
	writer := zip.NewWriter(file)
	var recordingRoot *os.Root
	defer func() {
		if recordingRoot != nil {
			recordingRoot.Close()
		}
	}()
	total := int64(0)
	for i := range m.Sessions {
		v := &m.Sessions[i]
		original := v.AudioPath
		v.AudioPath = ""
		if !includeAudio || original == "" {
			continue
		}
		owned, e := s.ownedAudio(original)
		if e != nil {
			return summary, e
		}
		if !owned {
			summary.MissingRecordings++
			continue
		}
		if recordingRoot == nil {
			recordingRoot, e = s.recordingRoot()
			if e != nil {
				return summary, e
			}
		}
		f, e := recordingRoot.Open(filepath.Base(original))
		if e != nil {
			return summary, e
		}
		info, e := f.Stat()
		if e != nil || !info.Mode().IsRegular() || info.Size() > maxBackupAudioBytes {
			f.Close()
			return summary, errors.New("retained recording is unreadable or exceeds 20 MiB")
		}
		entry, e := writer.Create(archiveAudioName(v.ID))
		if e == nil {
			var n int64
			n, e = io.Copy(entry, io.LimitReader(backupReader{ctx, f}, maxBackupAudioBytes+1))
			total += n
			if n > maxBackupAudioBytes || total > maxBackupBytes-maxManifestBytes {
				e = errors.New("recordings exceed the backup size limit")
			}
		}
		f.Close()
		if e != nil {
			return summary, e
		}
		v.AudioPath = archiveAudioName(v.ID)
		summary.Recordings++
	}
	if err = validateBackupManifest(&m); err != nil {
		return summary, err
	}
	data, err := json.Marshal(m)
	if err != nil {
		return summary, err
	}
	if int64(len(data)) > maxManifestBytes {
		return summary, errors.New("backup metadata exceeds 64 MiB")
	}
	entry, err := writer.Create("manifest.json")
	if err != nil {
		return summary, err
	}
	if _, err = entry.Write(data); err != nil {
		return summary, err
	}
	if err = writer.Close(); err != nil {
		return summary, err
	}
	if err = file.Sync(); err != nil {
		return summary, err
	}
	info, err := file.Stat()
	if err != nil {
		return summary, err
	}
	if info.Size() > maxBackupBytes {
		return summary, errors.New("backup exceeds 2 GiB")
	}
	if err = file.Close(); err != nil {
		return summary, err
	}
	if err = ctx.Err(); err != nil {
		return summary, err
	}
	if err = os.Rename(file.Name(), path); err != nil {
		return summary, err
	}
	summary.Sessions, summary.Outputs, summary.Prompts, summary.Vocabulary = len(m.Sessions), len(m.Outputs), len(m.Prompts), len(m.Vocabulary)
	return summary, nil
}

func validBackupString(value string, max int) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= max && !strings.ContainsRune(value, 0)
}
func validBackupID(value string) bool {
	return value != "" && validBackupString(value, 80) && !strings.ContainsAny(value, "\r\n")
}

func validateBackupManifest(m *backupManifest) error {
	if m.Format != "yap-backup" || m.Version != backupVersion {
		return errors.New("unsupported Yap backup version")
	}
	if _, err := time.Parse(time.RFC3339Nano, m.CreatedAt); err != nil {
		return errors.New("invalid backup date")
	}
	if !regexp.MustCompile(`^(auto|[a-z]{2,3})$`).MatchString(m.Preferences.Language) || (m.Preferences.Interaction != "hold" && m.Preferences.Interaction != "toggle") {
		return errors.New("invalid backup preferences")
	}
	if len(m.Sessions) > maxBackupEntries || len(m.Outputs) > maxBackupEntries {
		return errors.New("backup contains too many entries")
	}
	config := textmodel.Defaults()
	config.Prompts = m.Prompts
	config, err := textmodel.Normalize(config)
	if err != nil {
		return fmt.Errorf("invalid backup prompts: %w", err)
	}
	m.Prompts = config.Prompts
	m.Vocabulary, err = vocabulary.Normalize(m.Vocabulary)
	if err != nil {
		return fmt.Errorf("invalid backup vocabulary: %w", err)
	}
	ids := map[string]bool{}
	for _, v := range m.Sessions {
		if !validBackupID(v.ID) || ids[v.ID] || v.DurationMS < 0 || !validBackupString(v.CreatedAt, 100) || !validBackupString(v.RawTranscript, 100000) || !validBackupString(v.FinalTranscript, 100000) || !validBackupString(v.SpeechModel, 1000) || !validBackupString(v.Language, 100) || (v.AudioPath != "" && v.AudioPath != archiveAudioName(v.ID)) {
			return errors.New("invalid dictation in backup")
		}
		// Malformed legacy recording dates are retained by History and backups.
		ids[v.ID] = true
	}
	outputs := map[string]bool{}
	for _, v := range m.Outputs {
		if !validBackupID(v.ID) || outputs[v.ID] || !ids[v.SessionID] {
			return errors.New("invalid generated output reference in backup")
		}
		if _, err := time.Parse(time.RFC3339Nano, v.CreatedAt); err != nil {
			return errors.New("invalid generated output date")
		}
		if err := textmodel.ValidateText(v.Input); err != nil {
			return err
		}
		if err := textmodel.ValidateText(v.Text); err != nil {
			return err
		}
		if _, err := textmodel.Normalize(textmodel.Config{Enabled: true, Endpoint: v.Endpoint, Model: v.Model, Prompts: []textmodel.Prompt{v.Prompt}}); err != nil {
			return err
		}
		outputs[v.ID] = true
	}
	return nil
}

type backupReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r backupReader) Read(data []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(data)
}

func ReadBackup(ctx context.Context, path string) (_ *BackupArchive, err error) {
	reader, file, err := openBackupZIP(ctx, path)
	if err != nil {
		return nil, err
	}
	b := &BackupArchive{reader: reader, file: file, audio: map[string]*zip.File{}, hashes: map[string][32]byte{}}
	defer func() {
		if err != nil {
			b.Close()
		}
	}()
	if len(reader.File) > maxBackupEntries+1 {
		return nil, errors.New("backup contains too many files")
	}
	var manifest *zip.File
	seen, total := map[string]bool{}, uint64(0)
	for _, file := range reader.File {
		if seen[file.Name] || !file.Mode().IsRegular() {
			return nil, errors.New("backup contains duplicate or unsupported files")
		}
		seen[file.Name] = true
		limit := uint64(maxBackupAudioBytes)
		if file.Name == "manifest.json" {
			manifest = file
			limit = uint64(maxManifestBytes)
		} else {
			b.audio[file.Name] = file
		}
		if file.UncompressedSize64 > limit {
			return nil, errors.New("backup file exceeds its size limit")
		}
		total += file.UncompressedSize64
		if total > uint64(maxBackupBytes) {
			return nil, errors.New("expanded backup exceeds 2 GiB")
		}
	}
	if manifest == nil {
		return nil, errors.New("this file is not a Yap backup")
	}
	r, err := manifest.Open()
	if err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(backupReader{ctx, r}, maxManifestBytes+1))
	r.Close()
	if err != nil || int64(len(data)) > maxManifestBytes {
		return nil, errors.New("backup metadata is damaged or too large")
	}
	if err = json.Unmarshal(data, &b.manifest); err != nil {
		return nil, errors.New("invalid backup metadata")
	}
	if err = validateBackupManifest(&b.manifest); err != nil {
		return nil, err
	}
	referenced := map[string]bool{}
	for _, v := range b.manifest.Sessions {
		if v.AudioPath != "" {
			referenced[v.AudioPath] = true
		}
	}
	if len(referenced) != len(b.audio) {
		return nil, errors.New("backup contains unrecognized recording files")
	}
	for name := range referenced {
		file := b.audio[name]
		if file == nil {
			return nil, errors.New("a backed-up recording is missing")
		}
		r, err := file.Open()
		if err != nil {
			return nil, err
		}
		hash := sha256.New()
		n, err := io.Copy(hash, io.LimitReader(backupReader{ctx, r}, maxBackupAudioBytes+1))
		r.Close()
		if err != nil || n > maxBackupAudioBytes || uint64(n) != file.UncompressedSize64 {
			return nil, errors.New("a backed-up recording is damaged")
		}
		b.hashes[name] = [32]byte(hash.Sum(nil))
	}
	return b, nil
}

type restorePlan struct {
	summary    BackupSummary
	sessions   []Session
	outputs    []GeneratedOutput
	settings   Settings
	config     textmodel.Config
	vocabulary []vocabulary.Entry
}

func planBackup(ctx context.Context, tx *sql.Tx, b *BackupArchive) (p restorePlan, err error) {
	p.settings, p.config, p.vocabulary = Defaults(), textmodel.Defaults(), []vocabulary.Entry{}
	if err = readBackupValue(ctx, tx, "settings", &p.settings); err != nil {
		return
	}
	if err = readBackupValue(ctx, tx, "text_processing", &p.config); err != nil {
		return
	}
	if err = readBackupValue(ctx, tx, "vocabulary", &p.vocabulary); err != nil {
		return
	}
	if p.config, err = textmodel.Normalize(p.config); err != nil {
		return
	}
	var savedConfig int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM text_processing WHERE id=1").Scan(&savedConfig); err != nil {
		return
	}
	// Defaults on a fresh installation are not user-owned prompt conflicts.
	// Import the saved library while retaining this computer's server settings.
	if savedConfig == 0 {
		p.config.Prompts = []textmodel.Prompt{}
	}
	if p.vocabulary, err = vocabulary.Normalize(p.vocabulary); err != nil {
		return
	}
	parents := map[string]bool{}
	for _, v := range b.manifest.Sessions {
		var existing Session
		e := tx.QueryRowContext(ctx, "SELECT id,created_at,duration_ms,transcript,model,language FROM recordings WHERE id=?", v.ID).Scan(&existing.ID, &existing.CreatedAt, &existing.DurationMS, &existing.RawTranscript, &existing.SpeechModel, &existing.Language)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return p, e
		}
		if e == nil {
			p.summary.DuplicateSessions++
			// A collision from a different dictation cannot attach foreign outputs.
			parents[v.ID] = existing.CreatedAt == v.CreatedAt && existing.DurationMS == v.DurationMS && existing.RawTranscript == v.RawTranscript && existing.SpeechModel == v.SpeechModel && existing.Language == v.Language
			continue
		}
		parents[v.ID] = true
		p.sessions = append(p.sessions, v)
		if v.AudioPath != "" {
			p.summary.Recordings++
		}
	}
	for _, v := range b.manifest.Outputs {
		var count int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM generated_outputs WHERE id=?", v.ID).Scan(&count); err != nil {
			return
		}
		if count > 0 || !parents[v.SessionID] {
			p.summary.DuplicateOutputs++
			continue
		}
		p.outputs = append(p.outputs, v)
	}
	for _, v := range b.manifest.Prompts {
		found := false
		for _, existing := range p.config.Prompts {
			if existing.ID == v.ID {
				found = true
				break
			}
		}
		if found || len(p.config.Prompts) >= 30 {
			p.summary.SkippedPrompts++
			continue
		}
		p.config.Prompts = append(p.config.Prompts, v)
		p.summary.Prompts++
	}
	for _, v := range b.manifest.Vocabulary {
		candidate := append(append([]vocabulary.Entry{}, p.vocabulary...), v)
		normalized, e := vocabulary.Normalize(candidate)
		if e != nil {
			p.summary.SkippedVocabulary++
			continue
		}
		p.vocabulary = normalized
		p.summary.Vocabulary++
	}
	p.summary.Sessions, p.summary.Outputs = len(p.sessions), len(p.outputs)
	err = ctx.Err()
	return p, err
}

func (s *Store) PreviewBackup(ctx context.Context, b *BackupArchive) (BackupSummary, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BackupSummary{}, err
	}
	defer tx.Rollback()
	p, err := planBackup(ctx, tx, b)
	return p.summary, err
}

type RestoredBackup struct {
	Summary        BackupSummary
	Settings       Settings
	TextProcessing textmodel.Config
	Vocabulary     []vocabulary.Entry
}

// One database transaction preserves existing rows and makes retry idempotent.
// Newly allocated audio files are removed if any write or commit fails.
func (s *Store) RestoreBackup(ctx context.Context, b *BackupArchive, preferences bool) (_ RestoredBackup, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RestoredBackup{}, err
	}
	defer tx.Rollback()
	p, err := planBackup(ctx, tx, b)
	if err != nil {
		return RestoredBackup{}, err
	}
	var root *os.Root
	if p.summary.Recordings > 0 {
		root, err = s.recordingRoot()
		if err != nil {
			return RestoredBackup{}, err
		}
		defer root.Close()
	}
	created, committed := []string{}, false
	defer func() {
		if !committed && root != nil {
			for _, name := range created {
				if e := root.Remove(name); e != nil {
					err = errors.Join(err, fmt.Errorf("could not clean up restored recording: %w", e))
				}
			}
		}
	}()
	for _, v := range p.sessions {
		archivePath := v.AudioPath
		v.AudioPath = ""
		if archivePath != "" {
			name := uuid.NewString() + ".wav"
			file, e := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if e != nil {
				return RestoredBackup{}, e
			}
			created = append(created, name)
			r, e := b.audio[archivePath].Open()
			if e != nil {
				file.Close()
				return RestoredBackup{}, e
			}
			hash := sha256.New()
			n, e := io.Copy(io.MultiWriter(file, hash), io.LimitReader(backupReader{ctx, r}, maxBackupAudioBytes+1))
			r.Close()
			if e == nil {
				e = file.Sync()
			}
			e = errors.Join(e, file.Close())
			if e != nil || n > maxBackupAudioBytes || [32]byte(hash.Sum(nil)) != b.hashes[archivePath] {
				return RestoredBackup{}, errors.Join(errors.New("recording changed or failed to restore; select the backup again"), e)
			}
			v.AudioPath = filepath.Join(s.Dir, "recordings", name)
		}
		if _, err = tx.Exec("INSERT INTO recordings VALUES(?,?,?,?,?,?,?)", v.ID, v.CreatedAt, v.DurationMS, v.RawTranscript, v.SpeechModel, v.Language, v.AudioPath); err != nil {
			return RestoredBackup{}, err
		}
		if v.FinalTranscript != v.RawTranscript {
			if _, err = tx.Exec("INSERT INTO recording_outputs VALUES(?,?)", v.ID, v.FinalTranscript); err != nil {
				return RestoredBackup{}, err
			}
		}
	}
	for _, v := range p.outputs {
		if _, err = tx.Exec("INSERT INTO generated_outputs VALUES(?,?,?,?,?,?,?,?,?,?)", v.ID, v.SessionID, v.CreatedAt, v.Prompt.ID, v.Prompt.Name, v.Prompt.Instruction, v.Model, v.Endpoint, v.Input, v.Text); err != nil {
			return RestoredBackup{}, err
		}
	}
	if preferences {
		v := b.manifest.Preferences
		p.settings.Language, p.settings.Interaction, p.settings.AutoPaste, p.settings.SaveAudio, p.settings.CleanText = v.Language, v.Interaction, v.AutoPaste, v.SaveAudio, v.CleanText
	}
	for _, value := range []struct {
		table string
		value any
	}{{"settings", p.settings}, {"text_processing", p.config}, {"vocabulary", p.vocabulary}} {
		data, e := json.Marshal(value.value)
		if e != nil {
			return RestoredBackup{}, e
		}
		if _, err = tx.Exec("INSERT INTO "+value.table+"(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", string(data)); err != nil {
			return RestoredBackup{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return RestoredBackup{}, err
	}
	committed = true
	return RestoredBackup{p.summary, p.settings, p.config, p.vocabulary}, nil
}
