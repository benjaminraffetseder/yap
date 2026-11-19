//go:build linux && cgo

package platform

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

type testShortcutPortal struct {
	conn           *dbus.Conn
	address        string
	session        dbus.ObjectPath
	bindings       chan []portalShortcut
	closed         atomic.Int32
	response       atomic.Uint32
	empty          atomic.Bool
	noResponse     atomic.Bool
	registered     atomic.Bool
	bindingOptions atomic.Value // map[string]dbus.Variant; nil uses the requested trigger.
	expectedAppID  atomic.Value // string; nil uses the existing desktop identity.
}

func (p *testShortcutPortal) Register(id string, options map[string]dbus.Variant) *dbus.Error {
	expected := "com.yap.desktop"
	if value := p.expectedAppID.Load(); value != nil {
		expected = value.(string)
	}
	if id != expected {
		return dbus.MakeFailedError(fmt.Errorf("unexpected app id: %s", id))
	}
	p.registered.Store(true)
	return nil
}

func (p *testShortcutPortal) respond(sender dbus.Sender, options map[string]dbus.Variant, response uint32, result map[string]dbus.Variant) dbus.ObjectPath {
	handle := dbus.ObjectPath("/org/freedesktop/portal/desktop/request/" + strings.ReplaceAll(strings.TrimPrefix(string(sender), ":"), ".", "_") + "/" + options["handle_token"].Value().(string))
	p.conn.Emit(handle, portalRequestInterface+".Response", response, result)
	return handle
}

func (p *testShortcutPortal) CreateSession(sender dbus.Sender, options map[string]dbus.Variant) (dbus.ObjectPath, *dbus.Error) {
	if !p.registered.Load() {
		return "", dbus.MakeFailedError(fmt.Errorf("an app id is required"))
	}
	return p.respond(sender, options, 0, map[string]dbus.Variant{"session_handle": dbus.MakeVariant(string(p.session))}), nil
}

func (p *testShortcutPortal) BindShortcuts(sender dbus.Sender, session dbus.ObjectPath, shortcuts []portalShortcut, parent string, options map[string]dbus.Variant) (dbus.ObjectPath, *dbus.Error) {
	if session != p.session || parent != "" {
		return "", dbus.MakeFailedError(fmt.Errorf("unexpected session or parent"))
	}
	p.bindings <- shortcuts
	if p.noResponse.Load() {
		handle := dbus.ObjectPath("/org/freedesktop/portal/desktop/request/pending")
		return handle, nil
	}
	var bindings []portalShortcut
	if !p.empty.Load() {
		for _, shortcut := range shortcuts {
			boundOptions, ok := p.bindingOptions.Load().(map[string]dbus.Variant)
			if !ok {
				boundOptions = map[string]dbus.Variant{"trigger_description": shortcut.Options["preferred_trigger"]}
			}
			bindings = append(bindings, portalShortcut{ID: shortcut.ID, Options: boundOptions})
		}
	}
	return p.respond(sender, options, p.response.Load(), map[string]dbus.Variant{"shortcuts": dbus.MakeVariant(bindings)}), nil
}

func (p *testShortcutPortal) Close() *dbus.Error {
	p.closed.Add(1)
	return nil
}

func newTestShortcutPortal(t *testing.T) (*testShortcutPortal, *dbus.Conn) {
	t.Helper()
	if _, err := exec.LookPath("dbus-daemon"); err != nil {
		t.Skip("dbus-daemon is needed for the isolated portal integration test")
	}
	cmd := exec.Command("dbus-daemon", "--session", "--nofork", "--print-address=1")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cmd.Process.Kill(); cmd.Wait() })
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatal("private D-Bus did not publish its address")
	}
	address := scanner.Text()
	server, err := dbus.Connect(address)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close() })
	if _, err := server.RequestName(shortcutPortalBus, dbus.NameFlagDoNotQueue); err != nil {
		t.Fatal(err)
	}
	p := &testShortcutPortal{conn: server, address: address, session: "/org/freedesktop/portal/desktop/session/test", bindings: make(chan []portalShortcut, 1)}
	if err := server.Export(p, shortcutPortalPath, shortcutPortalInterface); err != nil {
		t.Fatal(err)
	}
	if err := server.Export(p, p.session, portalSessionInterface); err != nil {
		t.Fatal(err)
	}
	if err := server.Export(p, shortcutPortalPath, portalRegistryInterface); err != nil {
		t.Fatal(err)
	}
	if err := server.Export(p, "/org/freedesktop/portal/desktop/request/pending", portalRequestInterface); err != nil {
		t.Fatal(err)
	}
	client, err := dbus.Connect(address, dbus.WithSignalHandler(dbus.NewSequentialSignalHandler()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	return p, client
}

func TestPortalShortcutTrigger(t *testing.T) {
	for value, want := range map[string]string{"Ctrl+Alt+Space": "CTRL+ALT+space", "Ctrl+F12": "CTRL+F12", "Shift+Z": "SHIFT+z"} {
		if got, err := portalShortcutTrigger(value); err != nil || got != want {
			t.Errorf("%s: got %q, %v, want %q", value, got, err, want)
		}
	}
	if _, err := portalShortcutTrigger("Meta+P"); err == nil {
		t.Fatal("unsupported shortcut accepted")
	}
}

func TestPortalShortcutRegistrationAndEdges(t *testing.T) {
	p, conn := newTestShortcutPortal(t)
	calls := make(chan string, 8)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	s, err := registerPortalShortcut(ctx, conn, "com.yap.desktop", "Ctrl+F12", func() { calls <- "down" }, func() { calls <- "up" })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	bindings := <-p.bindings
	if len(bindings) != 1 || bindings[0].Options["preferred_trigger"].Value() != "CTRL+F12" {
		t.Fatalf("wrong preferred trigger: %v", bindings)
	}
	id := bindings[0].ID
	emit := func(session dbus.ObjectPath, shortcutID, edge string) {
		t.Helper()
		if err := p.conn.Emit(shortcutPortalPath, shortcutPortalInterface+"."+edge, session, shortcutID, uint64(1), map[string]dbus.Variant{}); err != nil {
			t.Fatal(err)
		}
	}
	emit("/another/session", id, "Activated")
	emit(p.session, "another-shortcut", "Activated")
	select {
	case edge := <-calls:
		t.Fatalf("unrelated shortcut delivered %s", edge)
	case <-time.After(30 * time.Millisecond):
	}
	for _, edge := range []string{"Activated", "Activated", "Deactivated", "Deactivated", "Activated", "Deactivated"} {
		emit(p.session, id, edge)
	}
	for _, want := range []string{"down", "up", "down", "up"} {
		select {
		case got := <-calls:
			if got != want {
				t.Fatalf("got %s, want %s", got, want)
			}
		case <-ctx.Done():
			t.Fatal("lost shortcut edge")
		}
	}
	s.Close()
	s.Close()
	if p.closed.Load() != 1 {
		t.Fatalf("session closed %d times", p.closed.Load())
	}
	emit(p.session, id, "Activated")
	select {
	case edge := <-calls:
		t.Fatalf("closed shortcut delivered %s", edge)
	case <-time.After(30 * time.Millisecond):
	}
}

func TestPortalShortcutFailureClosesSession(t *testing.T) {
	for _, mode := range []string{"cancelled", "denied", "empty", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			p, conn := newTestShortcutPortal(t)
			p.empty.Store(mode == "empty")
			p.noResponse.Store(mode == "timeout")
			if mode == "cancelled" {
				p.response.Store(1)
			} else if mode == "denied" {
				p.response.Store(2)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			s, err := registerPortalShortcut(ctx, conn, "com.yap.desktop", "Ctrl+F12", func() {}, func() {})
			if err == nil || s != nil {
				t.Fatal("unsuccessful portal binding was registered")
			}
			if mode == "cancelled" && !errors.Is(err, context.Canceled) {
				t.Fatalf("desktop cancellation lost its identity: %v", err)
			}
			wantClosed := int32(1)
			if mode == "timeout" {
				wantClosed++ // Both the pending request and session must close.
			}
			if p.closed.Load() != wantClosed {
				t.Fatalf("closed %d objects, want %d", p.closed.Load(), wantClosed)
			}
		})
	}
}

func TestPortalShortcutUnassignedBindingClosesSession(t *testing.T) {
	for name, options := range map[string]map[string]dbus.Variant{
		"empty":   {"trigger_description": dbus.MakeVariant("")},
		"missing": {},
		"blank":   {"trigger_description": dbus.MakeVariant(" \t ")},
	} {
		t.Run(name, func(t *testing.T) {
			p, conn := newTestShortcutPortal(t)
			p.bindingOptions.Store(options)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			s, err := registerPortalShortcut(ctx, conn, "com.yap.desktop", "Ctrl+F12", func() {}, func() {})
			if s != nil {
				s.Close()
			}
			if err == nil || s != nil {
				t.Fatal("unassigned portal shortcut was registered")
			}
			if !strings.Contains(err.Error(), "assign") || !strings.Contains(err.Error(), "retry") {
				t.Fatalf("unassigned shortcut has no actionable error: %v", err)
			}
			if p.closed.Load() != 1 {
				t.Fatalf("session closed %d times, want 1", p.closed.Load())
			}
		})
	}
}

func TestPortalShortcutKDEEffectiveBinding(t *testing.T) {
	for _, tc := range []struct {
		name              string
		desktop           string
		keys              []int32
		wantError         bool
		daemonUnavailable bool
	}{
		{name: "daemon-unavailable", desktop: "KDE", daemonUnavailable: true},
		{name: "unassigned", desktop: "KDE", keys: []int32{}, wantError: true},
		{name: "zero-key", desktop: "KDE", keys: []int32{0}, wantError: true},
		{name: "assigned", desktop: "KDE", keys: []int32{83886139}},
		{name: "desktop-list", desktop: "test:kde", keys: []int32{83886139}},
		{name: "other-desktop", desktop: "GNOME", keys: []int32{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("XDG_CURRENT_DESKTOP", tc.desktop)
			p, conn := newTestShortcutPortal(t)
			calls := make(chan []string, 1)
			if !tc.daemonUnavailable {
				if _, err := p.conn.RequestName("org.kde.kglobalaccel", dbus.NameFlagDoNotQueue); err != nil {
					t.Fatal(err)
				}
				if err := p.conn.ExportMethodTable(map[string]any{
					"shortcut": func(action []string) ([]int32, *dbus.Error) {
						calls <- action
						return tc.keys, nil
					},
				}, "/kglobalaccel", "org.kde.KGlobalAccel"); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			s, err := registerPortalShortcut(ctx, conn, "com.yap.desktop", "Ctrl+F12", func() {}, func() {})
			if s != nil {
				s.Close()
			}
			if tc.wantError {
				if err == nil || s != nil {
					t.Fatal("KDE shortcut without an active key was registered")
				}
				if !strings.Contains(err.Error(), "assign") || !strings.Contains(err.Error(), "retry") {
					t.Fatalf("unassigned shortcut has no actionable error: %v", err)
				}
			} else if err != nil || s == nil {
				t.Fatalf("available portal shortcut rejected: %v", err)
			}
			select {
			case action := <-calls:
				if tc.desktop == "GNOME" || strings.Join(action, "|") != "com.yap.desktop|yap_CTRL_F12||" {
					t.Fatalf("unexpected KDE shortcut query: %v", action)
				}
			default:
				if tc.desktop != "GNOME" && !tc.daemonUnavailable {
					t.Fatal("KDE active binding was not checked")
				}
			}
			if p.closed.Load() != 1 {
				t.Fatalf("session closed %d times, want 1", p.closed.Load())
			}
		})
	}
}

func TestWaylandShortcutIdentityPreservesInstalledLauncher(t *testing.T) {
	for _, tc := range []struct{ desktop, identity string }{
		{"KDE", "com.yap.shortcuts"},
		{"test:kde", "com.yap.shortcuts"},
		{"GNOME", "com.yap.desktop"},
	} {
		t.Run(tc.desktop, func(t *testing.T) {
			home, system := t.TempDir(), t.TempDir()
			t.Setenv("XDG_DATA_HOME", home)
			t.Setenv("XDG_DATA_DIRS", system)
			t.Setenv("XDG_CURRENT_DESKTOP", tc.desktop)
			t.Setenv("XDG_SESSION_TYPE", "wayland")
			installed := filepath.Join(system, "applications", "com.yap.desktop.desktop")
			if err := os.MkdirAll(filepath.Dir(installed), 0755); err != nil {
				t.Fatal(err)
			}
			const launcher = "[Desktop Entry]\nType=Application\nName=Installed Yap\nExec=/usr/bin/yap\n"
			if err := os.WriteFile(installed, []byte(launcher), 0644); err != nil {
				t.Fatal(err)
			}
			p, _ := newTestShortcutPortal(t)
			p.expectedAppID.Store(tc.identity)
			t.Setenv("DBUS_SESSION_BUS_ADDRESS", p.address)
			if _, err := p.conn.RequestName("org.kde.kglobalaccel", dbus.NameFlagDoNotQueue); err != nil {
				t.Fatal(err)
			}
			if err := p.conn.ExportMethodTable(map[string]any{
				"shortcut": func(action []string) ([]int32, *dbus.Error) {
					if action[0] != tc.identity {
						return nil, dbus.MakeFailedError(fmt.Errorf("wrong shortcut identity: %v", action))
					}
					return []int32{201326624}, nil // Ctrl+Alt+Space.
				},
			}, "/kglobalaccel", "org.kde.KGlobalAccel"); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			s, err := registerWaylandShortcutContext(ctx, "Ctrl+Alt+Space", func() {}, func() {})
			if err != nil {
				t.Fatal(err)
			}
			s.Close()
			if data, err := os.ReadFile(installed); err != nil || string(data) != launcher {
				t.Fatal("installed launcher changed", err)
			}
			if _, err := os.Stat(filepath.Join(home, "applications", "com.yap.desktop.desktop")); !os.IsNotExist(err) {
				t.Fatal("installed launcher was shadowed")
			}
			alias := filepath.Join(home, "applications", "com.yap.shortcuts.desktop")
			data, err := os.ReadFile(alias)
			if tc.identity == "com.yap.shortcuts" {
				if err != nil || !strings.Contains(string(data), "NoDisplay=true\n") {
					t.Fatal("KDE shortcut identity has no hidden desktop entry", err)
				}
			} else if !os.IsNotExist(err) {
				t.Fatal("another desktop's shortcut identity changed")
			}
		})
	}
}

func TestX11SessionKeepsNativeShortcutBackend(t *testing.T) {
	t.Setenv("XDG_SESSION_TYPE", "x11")
	t.Setenv("WAYLAND_DISPLAY", "wayland-0")
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent")
	if s, err := registerWaylandShortcut("Ctrl+F12", func() {}, func() {}); s != nil || err != nil {
		t.Fatal("X11 registration tried the Wayland portal", err)
	}
}

func TestWaylandShortcutDesktopIntegration(t *testing.T) {
	if os.Getenv("YAP_SHORTCUT_INTEGRATION") != "1" {
		t.Skip("set YAP_SHORTCUT_INTEGRATION=1 and approve the system shortcut dialog")
	}
	value := os.Getenv("YAP_SHORTCUT_TEST_KEY")
	if value == "" {
		value = "Ctrl+Shift+F12"
	}
	if _, err := portalShortcutTrigger(value); err != nil {
		t.Fatalf("invalid YAP_SHORTCUT_TEST_KEY %q: %v", value, err)
	}
	t.Logf("Requesting %s; approve the system shortcut dialog, then press and release it", value)
	executable, err := filepath.Abs("../../build/bin/yap")
	if err != nil {
		t.Fatal(err)
	}
	if err := ensurePortalDesktopEntry(executable); err != nil {
		t.Fatal(err)
	}
	// GNOME stores bindings by application, so the live test must not use
	// the running app's identity or replace its configured shortcuts.
	dataHome := os.Getenv("XDG_DATA_HOME")
	if !filepath.IsAbs(dataHome) {
		home, err := os.UserHomeDir()
		if err != nil {
			t.Fatal(err)
		}
		dataHome = filepath.Join(home, ".local", "share")
	}
	const testID = "com.yap.shortcut-test"
	entry := filepath.Join(dataHome, "applications", testID+".desktop")
	if err := os.MkdirAll(filepath.Dir(entry), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte("[Desktop Entry]\nType=Application\nName=Yap Shortcut Test\nExec=true\nNoDisplay=true\n"), 0644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(entry) })
	conn, err := dbus.ConnectSessionBus(dbus.WithSignalHandler(dbus.NewSequentialSignalHandler()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	calls := make(chan string, 8)
	s, err := registerPortalShortcut(ctx, conn, testID, value, func() { calls <- "down" }, func() { calls <- "up" })
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	t.Logf("%s registered; press and release it to verify desktop delivery", value)
	for _, want := range []string{"down", "up"} {
		select {
		case got := <-calls:
			if got != want {
				t.Fatalf("got %s, want %s", got, want)
			}
		case <-ctx.Done():
			t.Fatal("no desktop shortcut received", ctx.Err())
		}
	}
}

func TestPortalShortcutSessionLossReleasesHoldAndInvalidatesRegistration(t *testing.T) {
	for _, mode := range []string{"closed", "removed", "changed", "owner-lost"} {
		t.Run(mode, func(t *testing.T) {
			p, conn := newTestShortcutPortal(t)
			calls := make(chan string, 4)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			s, err := registerPortalShortcut(ctx, conn, "com.yap.desktop", "Ctrl+F12", func() { calls <- "down" }, func() { calls <- "up" })
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			binding := (<-p.bindings)[0]
			if mode == "changed" {
				// Use the dispatcher directly to include a compositor's initial effective binding.
				s.Close()
				signals := make(chan *dbus.Signal, 1)
				signals <- &dbus.Signal{Name: shortcutPortalInterface + ".ShortcutsChanged", Body: []any{p.session, []portalShortcut{{ID: binding.ID, Options: map[string]dbus.Variant{"trigger_description": dbus.MakeVariant("Ctrl+F11")}}}}}
				if err := dispatchPortalShortcut(signals, make(chan struct{}), p.session, binding.ID, "Ctrl+F12", func() {}, func() {}); err == nil {
					t.Fatal("effective binding change ignored")
				}
				return
			}
			if err := p.conn.Emit(shortcutPortalPath, shortcutPortalInterface+".Activated", p.session, binding.ID, uint64(1), map[string]dbus.Variant{}); err != nil {
				t.Fatal(err)
			}
			select {
			case <-calls:
			case <-ctx.Done():
				t.Fatal("activation lost")
			}
			switch mode {
			case "closed":
				err = p.conn.Emit(p.session, portalSessionInterface+".Closed", map[string]dbus.Variant{})
			case "removed":
				err = p.conn.Emit(shortcutPortalPath, shortcutPortalInterface+".ShortcutsChanged", p.session, []portalShortcut{})
			case "owner-lost":
				_, err = p.conn.ReleaseName(shortcutPortalBus)
			}
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-s.Done():
			case <-ctx.Done():
				t.Fatal("session loss not reported")
			}
			if s.Err() == nil {
				t.Fatal("lost session has no failure")
			}
			select {
			case edge := <-calls:
				if edge != "up" {
					t.Fatal(edge)
				}
			case <-ctx.Done():
				t.Fatal("recording hold was not released")
			}
		})
	}
}
