package startup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLinuxAutostartRegistration(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_DIRS", t.TempDir())
	controller, err := New()
	if err != nil {
		t.Fatal(err)
	}
	s := controller.(*linuxStartup)
	if enabled, err := s.Enabled(); err != nil || enabled {
		t.Fatalf("missing entry: %v, %v", enabled, err)
	}
	if err := s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	s.executable = "/Apps & Tools/Yap $test `x` \"quoted\" 100%\\yap"
	for _, executable := range []string{s.executable, "/new location/yap"} {
		s.executable = executable
		if err := s.SetEnabled(true); err != nil {
			t.Fatal(err)
		}
		if enabled, err := s.Enabled(); err != nil || !enabled {
			t.Fatalf("entry not enabled: %v, %v", enabled, err)
		}
		data, err := os.ReadFile(s.path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), "Exec=\"") || strings.Contains(string(data), "\nHidden=true") {
			t.Fatalf("invalid entry: %s", data)
		}
	}
	other := filepath.Join(filepath.Dir(s.path), "other.desktop")
	if err := os.WriteFile(other, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if enabled, err := s.Enabled(); err != nil || enabled {
		t.Fatalf("entry not removed: %v, %v", enabled, err)
	}
	if data, err := os.ReadFile(other); err != nil || string(data) != "keep" {
		t.Fatal("changed another application's startup entry")
	}
}

func TestLinuxAutostartHonorsDesktopDisablingAndSystemOverride(t *testing.T) {
	s := &linuxStartup{path: filepath.Join(t.TempDir(), "user.desktop"), executable: "/usr/bin/yap", systemPaths: []string{filepath.Join(t.TempDir(), "system.desktop")}}
	base := "[Desktop Entry]\nType=Application\nExec=/usr/bin/yap\n"
	t.Setenv("XDG_CURRENT_DESKTOP", "ubuntu:GNOME")
	for _, test := range []struct {
		keys string
		want bool
	}{
		{"", true}, {"Hidden=true\n", false}, {"X-GNOME-Autostart-enabled=false\n", false},
		{"OnlyShowIn=GNOME;KDE;\n", true}, {"OnlyShowIn=KDE;\n", false},
		{"NotShowIn=GNOME;\n", false}, {"TryExec=/nonexistent/yap-test\n", false},
	} {
		if err := os.WriteFile(s.systemPaths[0], []byte(base+test.keys), 0600); err != nil {
			t.Fatal(err)
		}
		if enabled, err := s.Enabled(); err != nil || enabled != test.want {
			t.Fatalf("keys %q: enabled=%v, error=%v", test.keys, enabled, err)
		}
	}
	if err := os.WriteFile(s.systemPaths[0], []byte(base), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if enabled, err := s.Enabled(); err != nil || enabled {
		t.Fatalf("system entry not masked: %v, %v", enabled, err)
	}
	if err := s.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if enabled, err := s.Enabled(); err != nil || !enabled {
		t.Fatalf("user override not enabled: %v, %v", enabled, err)
	}
	if data, err := os.ReadFile(s.systemPaths[0]); err != nil || string(data) != base {
		t.Fatal("changed the system startup entry")
	}
}

func TestLinuxAutostartIgnoresRelativeXDGPathsAndKeepsFailedWriteAtomic(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", "relative")
	t.Setenv("XDG_CONFIG_DIRS", "also-relative")
	controller, err := New()
	if err != nil {
		t.Fatal(err)
	}
	s := controller.(*linuxStartup)
	if s.path != filepath.Join(home, ".config", "autostart", loginDesktopFile) || len(s.systemPaths) != 0 {
		t.Fatalf("relative XDG path accepted: %+v", s)
	}
	if err := os.MkdirAll(s.path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEnabled(true); err == nil {
		t.Fatal("overwrote a directory")
	}
	files, err := os.ReadDir(filepath.Dir(s.path))
	if err != nil || len(files) != 1 || !files[0].IsDir() {
		t.Fatalf("partial startup files remain: %v, %v", files, err)
	}
}
