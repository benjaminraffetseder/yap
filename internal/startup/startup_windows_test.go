package startup

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"golang.org/x/sys/windows/registry"
)

func TestWindowsRegistration(t *testing.T) {
	// Exercise the native registry API under a disposable key, never the real
	// Run key. Tests cannot change the user's login behavior.
	s := &windowsStartup{key: fmt.Sprintf(`Software\YapStartupTest%d`, time.Now().UnixNano()), command: `"C:\Apps & Tools\Yap\yap.exe"`}
	t.Cleanup(func() { registry.DeleteKey(registry.CURRENT_USER, s.key) })
	if enabled, err := s.Enabled(); err != nil || enabled {
		t.Fatalf("missing registration: %v, %v", enabled, err)
	}
	if err := s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, s.key, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	defer key.Close()
	if err := key.SetStringValue("OtherApp", "keep"); err != nil {
		t.Fatal(err)
	}
	if command, _, err := key.GetStringValue("Yap"); err != nil || command != s.command {
		t.Fatalf("executable path lost quoting: %q, %v", command, err)
	}
	if enabled, err := s.Enabled(); err != nil || !enabled {
		t.Fatalf("registration not enabled: %v", err)
	}
	s.command = `"C:\New Location\Yap\yap.exe"`
	if err := s.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if command, _, err := key.GetStringValue("Yap"); err != nil || command != s.command {
		t.Fatalf("path not updated: %q, %v", command, err)
	}
	if err := s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if enabled, err := s.Enabled(); err != nil || enabled {
		t.Fatalf("registration not removed: %v", err)
	}
	if _, _, err := key.GetStringValue("Yap"); !errors.Is(err, registry.ErrNotExist) {
		t.Fatalf("Yap value still present: %v", err)
	}
	if other, _, err := key.GetStringValue("OtherApp"); err != nil || other != "keep" {
		t.Fatal("disabled another startup entry")
	}
}
