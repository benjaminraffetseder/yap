package platform

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPortalDesktopEntryPreservesInstalledIdentity(t *testing.T) {
	home, system := t.TempDir(), t.TempDir()
	t.Setenv("XDG_DATA_HOME", home)
	t.Setenv("XDG_DATA_DIRS", system)
	path := filepath.Join(system, "applications", "com.yap.desktop.desktop")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	const installed = "[Desktop Entry]\nType=Application\nName=Installed Yap\nExec=/opt/yap\n"
	if err := os.WriteFile(path, []byte(installed), 0644); err != nil {
		t.Fatal(err)
	}
	if err := ensurePortalDesktopEntry("/some/development/yap"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, "applications", "com.yap.desktop.desktop")); !os.IsNotExist(err) {
		t.Fatal("development identity shadowed the installed application")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != installed {
		t.Fatal("installed desktop entry changed", err)
	}
}

func TestPortalDesktopEntryForUnpackagedBuild(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_DATA_HOME", home)
	t.Setenv("XDG_DATA_DIRS", t.TempDir())
	if err := ensurePortalDesktopEntry("/opt/Yap build/yap"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, "applications", "com.yap.desktop.desktop")
	data, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(data), "Name=Yap\n") || !strings.Contains(string(data), "NoDisplay=true\n") || !strings.Contains(string(data), "Exec=\"/opt/Yap build/yap\"\n") {
		t.Fatal("unpackaged build has no usable desktop identity", string(data), err)
	}
}

func TestInstalledLauncherReplacesOnlyGeneratedPortalHelper(t *testing.T) {
	for _, kind := range []string{"current", "legacy", "custom"} {
		t.Run(kind, func(t *testing.T) {
			home, system := t.TempDir(), t.TempDir()
			t.Setenv("XDG_DATA_HOME", home)
			t.Setenv("XDG_DATA_DIRS", system)
			if err := ensurePortalDesktopEntry("/development/yap"); err != nil {
				t.Fatal(err)
			}
			user := filepath.Join(home, "applications", "com.yap.desktop.desktop")
			if kind == "legacy" {
				data, _ := os.ReadFile(user)
				if err := os.WriteFile(user, []byte(strings.ReplaceAll(string(data), "X-Yap-PortalIdentity=true\n", "")), 0644); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "custom" {
				if err := os.WriteFile(user, []byte("[Desktop Entry]\nType=Application\nName=My Yap\nExec=/custom/yap\n"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			installed := filepath.Join(system, "applications", "com.yap.desktop.desktop")
			if err := os.MkdirAll(filepath.Dir(installed), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(installed, []byte("[Desktop Entry]\nType=Application\nName=Yap\nExec=/usr/bin/yap\n"), 0644); err != nil {
				t.Fatal(err)
			}
			// Startup cleanup must work without registering shortcuts or opening a portal.
			if err := PrepareDesktopEntry(); err != nil {
				t.Fatal(err)
			}
			_, err := os.Stat(user)
			if kind == "custom" && err != nil || kind != "custom" && !os.IsNotExist(err) {
				t.Fatalf("incorrect launcher override migration: %v", err)
			}
		})
	}
}
