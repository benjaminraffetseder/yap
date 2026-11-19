//go:build linux && cgo

package platform

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

type testAccessible struct {
	mu       sync.Mutex
	children []accessibleReference
	role     atomic.Uint32
	state    atomic.Uint32
	name     string
}

func (a *testAccessible) GetChildren() ([]accessibleReference, *dbus.Error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.children), nil
}

func (a *testAccessible) setChildren(children []accessibleReference) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.children = children
}

func (a *testAccessible) GetRole() (uint32, *dbus.Error) { return a.role.Load(), nil }

func (a *testAccessible) GetState() ([]uint32, *dbus.Error) {
	return []uint32{a.state.Load(), 0}, nil
}

func (a *testAccessible) Get(iface, property string) (dbus.Variant, *dbus.Error) {
	return dbus.MakeVariant(a.name), nil
}

func TestAccessibleApplicationEnumerationAndFocusUseSameIdentity(t *testing.T) {
	p, conn := newTestShortcutPortal(t)
	if _, err := p.conn.RequestName("org.a11y.atspi.Registry", dbus.NameFlagDoNotQueue); err != nil {
		t.Fatal(err)
	}
	bus := p.conn.Names()[0]
	window := &testAccessible{}
	window.role.Store(23)
	window.state.Store(1<<30 | 1<<1) // Visible and active.
	app := &testAccessible{name: "My Editor", children: []accessibleReference{{bus, "/editor/window"}, {bus, "/editor/window"}, {bus, "/gone"}}}
	background := &testAccessible{name: "Background service"}
	registry := &testAccessible{children: []accessibleReference{{bus, "/editor"}, {bus, "/background"}, {":9.999", "/stale"}}}
	for path, accessible := range map[dbus.ObjectPath]*testAccessible{a11yRoot: registry, "/editor": app, "/editor/window": window, "/background": background} {
		if err := p.conn.Export(accessible, path, a11yAccessible); err != nil {
			t.Fatal(err)
		}
		if err := p.conn.Export(accessible, path, "org.freedesktop.DBus.Properties"); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	want := linuxProcessApplication(uint32(os.Getpid()), 0)
	want.Name = "My Editor"
	apps, active, err := accessibleApplications(ctx, conn, 0)
	if err != nil || !reflect.DeepEqual(apps, []Application{want}) || active != want.ID {
		t.Fatalf("apps=%v active=%q err=%v", apps, active, err)
	}
	_, _, target, err := accessibleDesktop(ctx, conn, 0)
	if err != nil || target != "wayland:"+bus+":/editor/window" {
		t.Fatalf("active window has no stable paste target: %q, %v", target, err)
	}
	another := &testAccessible{}
	another.role.Store(23)
	another.state.Store(1<<30 | 1<<1)
	if err := p.conn.Export(another, "/editor/second", a11yAccessible); err != nil {
		t.Fatal(err)
	}
	app.setChildren([]accessibleReference{{bus, "/editor/second"}})
	_, _, second, err := accessibleDesktop(ctx, conn, 0)
	if err != nil || second == target || second == "" {
		t.Fatalf("different windows share a paste target: %q %q, %v", target, second, err)
	}
	app.setChildren([]accessibleReference{{bus, "/editor/window"}, {bus, "/editor/second"}})
	if _, _, target, err := accessibleDesktop(ctx, conn, 0); err != nil || target != "" {
		t.Fatalf("ambiguous focus authorized paste: %q, %v", target, err)
	}
	app.setChildren([]accessibleReference{{bus, "/editor/window"}})
	window.state.Store(1<<30 | 1<<12) // FOCUSED alone must not select a profile.
	if _, active, err := accessibleApplications(ctx, conn, 0); err != nil || active != "" {
		t.Fatalf("inactive app matched: %q, %v", active, err)
	}
	if apps, active, err := accessibleApplications(ctx, conn, uint32(os.Getpid())); err != nil || len(apps) != 0 || active != "" {
		t.Fatalf("Yap included itself: %v %q %v", apps, active, err)
	}
	window.role.Store(14) // Desktop frame, not an application window.
	if apps, active, err := accessibleApplications(ctx, conn, 0); err != nil || len(apps) != 0 || active != "" {
		t.Fatalf("desktop frame included: %v %q %v", apps, active, err)
	}
	cancel()
	if _, _, err := accessibleApplications(ctx, conn, 0); err == nil {
		t.Fatal("cancelled desktop query succeeded")
	}
}

func TestLinuxExecutableIdentityExcludesSelfAndDisappearedProcesses(t *testing.T) {
	pid := uint32(os.Getpid())
	for _, value := range []uint32{0, pid, ^uint32(0)} {
		if app := linuxProcessApplication(value, pid); app != (Application{}) {
			t.Fatal("invalid process matched", value, app)
		}
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	want := "linux:" + strings.ToLower(filepath.Base(executable))
	if app := linuxProcessApplication(pid, 0); app.ID != want {
		t.Fatal("unstable identity", app, want)
	}
}

func TestX11ApplicationsSkipWindowsWithoutPID(t *testing.T) {
	dir := t.TempDir()
	tool := `#!/bin/sh
case "$1" in
  search) printf '101\n102\n103\n104\n' ;;
  getwindowpid)
    case "$2" in
      101) exit 1 ;;
      102|103) printf '%s\n' "$YAP_TEST_APP_PID" ;;
      104) printf '%s\n' "$YAP_TEST_SELF_PID" ;;
    esac ;;
  getactivewindow) printf '%s\n' "$YAP_TEST_APP_PID" ;;
esac
`
	if err := os.WriteFile(filepath.Join(dir, "xdotool"), []byte(tool), 0755); err != nil {
		t.Fatal(err)
	}
	process := exec.Command("sleep", "10")
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { process.Process.Kill(); process.Wait() })
	t.Setenv("PATH", dir)
	t.Setenv("YAP_TEST_APP_PID", strconv.Itoa(process.Process.Pid))
	t.Setenv("YAP_TEST_SELF_PID", strconv.Itoa(os.Getpid()))
	t.Setenv("XDG_SESSION_TYPE", "x11")
	apps, err := Applications()
	if err != nil || !reflect.DeepEqual(apps, []Application{{ID: "linux:sleep", Name: "sleep"}}) {
		t.Fatal("open app lost after window without PID", apps, err)
	}
	if id := ActiveApplication(); id != "linux:sleep" {
		t.Fatal("focused app has different identity", id)
	}
}

func TestLinuxApplicationsIntegration(t *testing.T) {
	if os.Getenv("YAP_APPLICATIONS_INTEGRATION") != "1" {
		t.Skip("set YAP_APPLICATIONS_INTEGRATION=1 to query the live desktop")
	}
	apps, err := Applications()
	if err != nil || len(apps) == 0 {
		t.Fatal("no open applications", apps, err)
	}
	t.Logf("open applications: %+v", apps)
	active := ActiveApplication()
	t.Logf("active application: %s", active)
	if active != "" {
		for _, app := range apps {
			if app.ID == active {
				return
			}
		}
		t.Fatal("focused application missing from picker", active)
	}
}
