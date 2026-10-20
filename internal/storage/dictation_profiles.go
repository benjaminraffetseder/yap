package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"yap/internal/inference/text"
)

// Profiles reference this computer's speech models and shared saved prompts.
type DictationProfile struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ModelPath    string `json:"modelPath"`
	Language     string `json:"language"`
	CleanText    bool   `json:"cleanText"`
	AutoPromptID string `json:"autoPromptId"`
}

type ProfileLibrary struct {
	AppRules        []AppProfileRule   `json:"appRules,omitempty"`
	ProfileShortcut string             `json:"profileShortcut,omitempty"`
	DefaultID       string             `json:"defaultId,omitempty"`
	ActiveID        string             `json:"activeId"`
	Profiles        []DictationProfile `json:"profiles"`
}

func NormalizeProfiles(library ProfileLibrary) (ProfileLibrary, error) {
	limit := 20
	if library.DefaultID != "" {
		limit++
	}
	if len(library.Profiles) > limit {
		return ProfileLibrary{}, errors.New("save up to 20 dictation profiles")
	}
	library.Profiles = append([]DictationProfile{}, library.Profiles...)
	ids, names := map[string]bool{}, map[string]bool{}
	for i, p := range library.Profiles {
		p.Name = strings.TrimSpace(p.Name)
		if p.ID == "" || len(p.ID) > 80 || !utf8.ValidString(p.ID) || strings.ContainsAny(p.ID, "\r\n\x00") || ids[p.ID] {
			return ProfileLibrary{}, errors.New("profile identifiers must be unique and nonempty")
		}
		if p.Name == "" || utf8.RuneCountInString(p.Name) > 60 || !utf8.ValidString(p.Name) || strings.ContainsAny(p.Name, "\r\n\x00") || names[strings.ToLower(p.Name)] {
			return ProfileLibrary{}, errors.New("give each profile a unique name of up to 60 characters")
		}
		if (p.ModelPath == "" && p.ID != library.DefaultID) || len(p.ModelPath) > 32768 || !utf8.ValidString(p.ModelPath) || strings.ContainsRune(p.ModelPath, 0) {
			return ProfileLibrary{}, errors.New("choose a speech model for each profile")
		}
		if !regexp.MustCompile(`^(auto|[a-z]{2,3})$`).MatchString(p.Language) {
			return ProfileLibrary{}, errors.New("use auto or a language code such as en or de")
		}
		if len(p.AutoPromptID) > 80 || !utf8.ValidString(p.AutoPromptID) || strings.ContainsAny(p.AutoPromptID, "\r\n\x00") {
			return ProfileLibrary{}, errors.New("choose a saved prompt")
		}
		ids[p.ID], names[strings.ToLower(p.Name)] = true, true
		library.Profiles[i] = p
	}
	if library.ActiveID != "" && !ids[library.ActiveID] {
		return ProfileLibrary{}, errors.New("active dictation profile does not exist")
	}
	if library.DefaultID != "" && !ids[library.DefaultID] {
		return ProfileLibrary{}, errors.New("default dictation profile does not exist")
	}
	if len(library.ProfileShortcut) > 80 {
		return ProfileLibrary{}, errors.New("profile shortcut is too long")
	}
	if len(library.AppRules) > 50 {
		return ProfileLibrary{}, errors.New("use at most 50 application rules")
	}
	library.AppRules = append([]AppProfileRule(nil), library.AppRules...)
	apps := map[string]bool{}
	for i, rule := range library.AppRules {
		rule.ApplicationID = strings.ToLower(strings.TrimSpace(rule.ApplicationID))
		rule.ApplicationName = strings.TrimSpace(rule.ApplicationName)
		if rule.ApplicationID == "" || len(rule.ApplicationID) > 512 || !utf8.ValidString(rule.ApplicationID) || strings.ContainsAny(rule.ApplicationID, "\r\n\x00") || apps[rule.ApplicationID] {
			return ProfileLibrary{}, errors.New("choose each application only once")
		}
		if rule.ApplicationName == "" || utf8.RuneCountInString(rule.ApplicationName) > 120 || !utf8.ValidString(rule.ApplicationName) || strings.ContainsAny(rule.ApplicationName, "\r\n\x00") {
			return ProfileLibrary{}, errors.New("application names must contain 1–120 characters")
		}
		if !ids[rule.ProfileID] {
			return ProfileLibrary{}, errors.New("choose an existing profile for each application")
		}
		apps[rule.ApplicationID] = true
		library.AppRules[i] = rule
	}
	return library, nil
}

type AppProfileRule struct {
	ApplicationID   string `json:"applicationId"`
	ApplicationName string `json:"applicationName"`
	ProfileID       string `json:"profileId"`
}

// Capture the baseline once, after setup or when upgrading existing settings.
// Existing recipes stay intact, including an older user-created Default.
func WithDefaultProfile(library ProfileLibrary, settings Settings, config text.Config) (ProfileLibrary, bool, error) {
	if !settings.SetupComplete {
		return library, false, nil
	}
	library, err := NormalizeProfiles(library)
	if err != nil {
		return ProfileLibrary{}, false, err
	}
	changed := false
	if library.DefaultID == "" {
		for _, p := range library.Profiles {
			if strings.EqualFold(p.Name, "Default") {
				library.DefaultID = p.ID
				break
			}
		}
		if library.DefaultID == "" {
			p := profileFromSettings(uuid.NewString(), "Default", settings, config)
			library.DefaultID = p.ID
			library.Profiles = append([]DictationProfile{p}, library.Profiles...)
		}
		library.ActiveID, changed = library.DefaultID, true
	}
	if library.ActiveID == "" {
		library.ActiveID, changed = library.DefaultID, true
	}
	// Setup may be skipped before installing a model. Capture the first model
	// once it arrives so the Default baseline can actually be restored.
	for i, p := range library.Profiles {
		if p.ID == library.DefaultID && p.ModelPath == "" && settings.ModelPath != "" {
			library.Profiles[i] = profileFromSettings(p.ID, p.Name, settings, config)
			changed = true
		}
	}
	library, err = NormalizeProfiles(library)
	return library, changed, err
}

func profileFromSettings(id, name string, settings Settings, config text.Config) DictationProfile {
	return DictationProfile{ID: id, Name: name, ModelPath: settings.ModelPath, Language: settings.Language, CleanText: settings.CleanText, AutoPromptID: config.AutoPromptID}
}

func (p DictationProfile) Matches(settings Settings, config text.Config) bool {
	return p.ModelPath == settings.ModelPath && p.Language == settings.Language && p.CleanText == settings.CleanText && p.AutoPromptID == config.AutoPromptID
}

func (s *Store) DictationProfiles() (ProfileLibrary, error) {
	library := ProfileLibrary{Profiles: []DictationProfile{}}
	var raw string
	err := s.db.QueryRow("SELECT value FROM dictation_profiles WHERE id=1").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return library, nil
	}
	if err != nil {
		return library, err
	}
	if err = json.Unmarshal([]byte(raw), &library); err != nil {
		return library, err
	}
	return NormalizeProfiles(library)
}

func (s *Store) SaveDictationProfiles(library ProfileLibrary) error {
	library, err := NormalizeProfiles(library)
	if err != nil {
		return err
	}
	data, err := json.Marshal(library)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO dictation_profiles(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", string(data))
	return err
}

// A profile takes effect completely or not at all, including after restart.
func (s *Store) ApplyDictationProfile(library ProfileLibrary, settings Settings, config text.Config) error {
	library, err := NormalizeProfiles(library)
	if err != nil {
		return err
	}
	config, err = text.Normalize(config)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, item := range []struct {
		query string
		value any
	}{
		{"INSERT INTO settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", settings},
		{"INSERT INTO text_processing(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", config},
		{"INSERT INTO dictation_profiles(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", library},
	} {
		data, err := json.Marshal(item.value)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(item.query, string(data)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
