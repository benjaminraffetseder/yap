package platform

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	a11yAccessible = "org.a11y.atspi.Accessible"
	a11yRoot       = dbus.ObjectPath("/org/a11y/atspi/accessible/root")
)

type accessibleReference struct {
	Bus  string
	Path dbus.ObjectPath
}

func ActiveApplication() string {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if !waylandSession() {
		data, _ := exec.CommandContext(ctx, "xdotool", "getactivewindow", "getwindowpid").Output()
		pid, _ := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 32)
		return linuxProcessApplication(uint32(pid), uint32(os.Getpid())).ID
	}
	_, active, _ := waylandApplications(ctx)
	return active
}

func Applications() ([]Application, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if waylandSession() {
		apps, _, err := waylandApplications(ctx)
		return apps, err
	}
	return x11Applications(ctx)
}

// Match the executable identity on both display servers, including when an app
// has several windows or changes its title. Never match on a translated label.
func linuxProcessApplication(pid, self uint32) Application {
	if pid == 0 || pid == self {
		return Application{}
	}
	executable, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil {
		return Application{}
	}
	name := filepath.Base(strings.TrimSuffix(executable, " (deleted)"))
	switch name {
	case "gnome-shell", "plasmashell":
		return Application{}
	}
	return Application{ID: "linux:" + strings.ToLower(name), Name: name}
}

func x11Applications(ctx context.Context) ([]Application, error) {
	// Query each window separately: xdotool stops a chained getwindowpid at
	// the first window without _NET_WM_PID, hiding apps later in its result.
	data, err := exec.CommandContext(ctx, "xdotool", "search", "--onlyvisible", "--class", ".").Output()
	if err != nil {
		if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 1 {
			return nil, fmt.Errorf("could not list open X11 applications; install xdotool: %w", err)
		}
	}
	apps := map[string]Application{}
	for _, window := range strings.Fields(string(data)) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		data, err := exec.CommandContext(ctx, "xdotool", "getwindowpid", window).Output()
		if err != nil {
			continue // Windows can disappear between enumeration and lookup.
		}
		pid, _ := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 32)
		app := linuxProcessApplication(uint32(pid), uint32(os.Getpid()))
		if app.ID != "" {
			apps[app.ID] = app
		}
	}
	return sortedApplications(apps), nil
}

// GNOME deliberately restricts Shell.Introspect. AT-SPI provides application
// identities and active top-level window state without a Shell extension or
// enabling Shell's unsafe mode. Apps must expose their accessibility interface.
func waylandApplications(ctx context.Context) ([]Application, string, error) {
	conn, err := connectAccessibilityBus(ctx)
	if err != nil {
		return nil, "", err
	}
	defer conn.Close()
	return accessibleApplications(ctx, conn, uint32(os.Getpid()))
}

func connectAccessibilityBus(ctx context.Context) (*dbus.Conn, error) {
	session, err := dbus.ConnectSessionBus()
	if err != nil {
		return nil, err
	}
	defer session.Close()
	var address string
	if err := session.Object("org.a11y.Bus", "/org/a11y/bus").CallWithContext(ctx, "org.a11y.Bus.GetAddress", 0).Store(&address); err != nil {
		return nil, fmt.Errorf("Wayland foreground detection needs the desktop accessibility service (at-spi2-core): %w", err)
	}
	return dbus.Connect(address)
}

func accessibleApplications(ctx context.Context, conn *dbus.Conn, self uint32) ([]Application, string, error) {
	apps, active, _, err := accessibleDesktop(ctx, conn, self)
	return apps, active, err
}

// The bus name and object path identify a particular window, including distinct
// windows of one application. Ambiguous focus must never authorize a paste.
func accessibleDesktop(ctx context.Context, conn *dbus.Conn, self uint32) ([]Application, string, string, error) {
	var children []accessibleReference
	if err := conn.Object("org.a11y.atspi.Registry", a11yRoot).CallWithContext(ctx, a11yAccessible+".GetChildren", 0).Store(&children); err != nil {
		return nil, "", "", fmt.Errorf("could not list accessible applications: %w", err)
	}
	apps, active := map[string]Application{}, ""
	target, ambiguous := "", false
	for _, child := range children {
		var pid uint32
		if err := conn.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.GetConnectionUnixProcessID", 0, child.Bus).Store(&pid); err != nil {
			continue
		}
		app := linuxProcessApplication(pid, self)
		if app.ID == "" {
			continue
		}
		var windows []accessibleReference
		object := conn.Object(child.Bus, child.Path)
		if err := object.CallWithContext(ctx, a11yAccessible+".GetChildren", 0).Store(&windows); err != nil {
			continue
		}
		open, focused := false, false
		for _, window := range windows {
			object := conn.Object(window.Bus, window.Path)
			var role uint32
			if object.CallWithContext(ctx, a11yAccessible+".GetRole", 0).Store(&role) != nil {
				continue
			}
			// AT-SPI roles: dialog, frame, window. Background services and
			// desktop widgets are not applications for profile assignment.
			if role != 16 && role != 23 && role != 69 {
				continue
			}
			var state []uint32
			if object.CallWithContext(ctx, a11yAccessible+".GetState", 0).Store(&state) != nil || len(state) == 0 {
				continue
			}
			// ACTIVE describes the window, whereas FOCUSED may describe a
			// widget that retains keyboard focus in an inactive application.
			open = open || state[0]&(1<<30) != 0      // ATSPI_STATE_VISIBLE
			focused = focused || state[0]&(1<<1) != 0 // ATSPI_STATE_ACTIVE
			if state[0]&(1<<30|1<<1) == (1<<30 | 1<<1) {
				candidate := "wayland:" + window.Bus + ":" + string(window.Path)
				ambiguous = ambiguous || target != "" && target != candidate
				target = candidate
			}
		}
		if !open {
			continue
		}
		var label dbus.Variant
		if object.CallWithContext(ctx, "org.freedesktop.DBus.Properties.Get", 0, a11yAccessible, "Name").Store(&label) == nil {
			if name, ok := label.Value().(string); ok && strings.TrimSpace(name) != "" {
				app.Name = name
			}
		}
		apps[app.ID] = app
		if focused {
			active = app.ID
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, "", "", fmt.Errorf("desktop application lookup timed out: %w", err)
	}
	if ambiguous {
		target = ""
	}
	return sortedApplications(apps), active, target, nil
}
