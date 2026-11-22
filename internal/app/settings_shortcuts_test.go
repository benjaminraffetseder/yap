package app

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"yap/internal/app/shortcuts"
)

type testKeyBinding struct {
	value string
	held  map[string]bool
}

func (binding *testKeyBinding) Close() { delete(binding.held, binding.value) }

func TestSwapSettingsShortcuts(t *testing.T) {
	for _, scenario := range []string{"success", "second binding rejected", "persistence rejected"} {
		t.Run(scenario, func(t *testing.T) {
			a := testApp(t)
			held := map[string]bool{}
			var rejectNext string
			a.registerKey = func(value string, _, _ func()) (shortcutRegistration, error) {
				if value == rejectNext {
					rejectNext = ""
					return nil, errors.New("registration rejected")
				}
				if held[value] {
					return nil, errors.New("shortcut already held")
				}
				held[value] = true
				return &testKeyBinding{value, held}, nil
			}
			if err := a.SaveSettings(a.settings); err != nil {
				t.Fatal(err)
			}
			const oldProfile = "Ctrl+Alt+P"
			if err := a.SaveProfileAutomation(nil, oldProfile); err != nil {
				t.Fatal(err)
			}
			old := a.settings
			next := old
			next.Shortcut, next.Language = oldProfile, "de"
			if scenario == "second binding rejected" {
				rejectNext = old.Shortcut
			}
			if scenario == "persistence rejected" {
				db, err := sql.Open("sqlite", filepath.Join(a.store.Dir, "database.sqlite"))
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				if _, err := db.Exec("CREATE TRIGGER reject_swap BEFORE UPDATE ON dictation_profiles BEGIN SELECT RAISE(FAIL, 'reject swap'); END;"); err != nil {
					t.Fatal(err)
				}
			}
			err := a.SwapSettingsShortcuts(next, old.Shortcut)
			want, wantProfile := old, oldProfile
			if scenario == "success" {
				if err != nil {
					t.Fatal(err)
				}
				want, wantProfile = next, old.Shortcut
				recording := a.shortcuts.Registration(shortcuts.Recording)
				profile := a.shortcuts.Registration(shortcuts.Profile)
				if err := a.SwapSettingsShortcuts(next, old.Shortcut); err != nil {
					t.Fatal(err)
				}
				if recording != a.shortcuts.Registration(shortcuts.Recording) || profile != a.shortcuts.Registration(shortcuts.Profile) {
					t.Fatal("retry replaced committed bindings")
				}
			} else if err == nil {
				t.Fatal("expected swap failure")
			}
			saved, err := a.store.Settings()
			if err != nil {
				t.Fatal(err)
			}
			library, err := a.store.DictationProfiles()
			if err != nil {
				t.Fatal(err)
			}
			if saved != want || a.settings != want || library.ProfileShortcut != wantProfile || a.profiles.Shortcut() != wantProfile {
				t.Fatalf("inconsistent configuration: saved=%+v active=%+v saved profile=%q active profile=%q", saved, a.settings, library.ProfileShortcut, a.profiles.Shortcut())
			}
			for kind, value := range map[shortcuts.Kind]string{shortcuts.Recording: want.Shortcut, shortcuts.Profile: wantProfile} {
				actual, ok := a.shortcuts.Registration(kind).(*testKeyBinding)
				if !ok || actual.value != value || !held[value] {
					t.Fatalf("binding %d should hold %s: %+v", kind, value, actual)
				}
			}
		})
	}
}
