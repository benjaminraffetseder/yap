//go:build !windows && !darwin

package platform

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWaylandNeverInvokesX11Paste(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "called")
	if err := os.WriteFile(filepath.Join(dir, "xdotool"), []byte("#!/bin/sh\necho called > \"$YAP_TEST_XDOTOOL_MARKER\"\necho 123\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent")
	t.Setenv("YAP_TEST_XDOTOOL_MARKER", marker)
	for _, sessionType := range []string{"wayland", ""} {
		t.Setenv("XDG_SESSION_TYPE", sessionType)
		t.Setenv("WAYLAND_DISPLAY", "wayland-0")
		if got := Target(); got != "" {
			t.Fatalf("unobservable Wayland window authorized paste: %q", got)
		}
		if err := Paste("123"); err == nil || !strings.Contains(err.Error(), "clipboard") {
			t.Fatal("Wayland paste did not explain clipboard fallback", err)
		}
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("Wayland invoked xdotool, which can request Remote Desktop permission")
	}
	t.Setenv("XDG_SESSION_TYPE", "x11")
	if Target() != "123" {
		t.Fatal("X11 target capture was changed")
	}
	if err := Paste("123"); err != nil {
		t.Fatal("X11 paste was changed", err)
	}
}
