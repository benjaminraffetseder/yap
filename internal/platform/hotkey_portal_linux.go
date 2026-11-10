//go:build linux && cgo

package platform

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/google/uuid"
)

const (
	shortcutPortalBus       = "org.freedesktop.portal.Desktop"
	shortcutPortalPath      = dbus.ObjectPath("/org/freedesktop/portal/desktop")
	shortcutPortalInterface = "org.freedesktop.portal.GlobalShortcuts"
	portalRequestInterface  = "org.freedesktop.portal.Request"
	portalSessionInterface  = "org.freedesktop.portal.Session"
	portalRegistryInterface = "org.freedesktop.host.portal.Registry"
)

type portalShortcut struct {
	ID      string
	Options map[string]dbus.Variant
}

func registerWaylandShortcut(value string, down, up func()) (*Shortcut, error) {
	return registerWaylandShortcutContext(context.Background(), value, down, up)
}

func registerWaylandShortcutContext(parent context.Context, value string, down, up func()) (*Shortcut, error) {
	if !waylandSession() {
		return nil, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	if err := ensurePortalDesktopEntry(executable); err != nil {
		return nil, fmt.Errorf("register Yap's desktop identity for Wayland shortcuts: %w", err)
	}
	// A private connection owns the session and its subscriptions. Preserve
	// signal order even if a recording callback blocks while opening audio.
	conn, err := dbus.ConnectSessionBus(dbus.WithSignalHandler(dbus.NewSequentialSignalHandler()))
	if err != nil {
		return nil, fmt.Errorf("Wayland global shortcuts need the desktop portal: %w", err)
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	shortcut, err := registerPortalShortcut(ctx, conn, "com.yap.desktop", value, down, up)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("Wayland shortcut: %w; enable Global Shortcuts in your desktop portal and retry", err)
	}
	return shortcut, nil
}

func registerPortalShortcut(ctx context.Context, conn *dbus.Conn, appID, value string, down, up func()) (*Shortcut, error) {
	trigger, err := portalShortcutTrigger(value)
	if err != nil {
		return nil, err
	}
	// Development and other unsandboxed launches have no inferred application
	// ID. GlobalShortcuts requires one, even when other portals do not.
	// Older portals may lack Registry; sandboxed apps already have an identity.
	identityErr := conn.Object(shortcutPortalBus, shortcutPortalPath).CallWithContext(ctx, portalRegistryInterface+".Register", 0, appID, map[string]dbus.Variant{}).Err
	signals := make(chan *dbus.Signal, 32)
	conn.Signal(signals)
	// Subscribe before making requests: a portal may emit Response before
	// the method reply reaches us. Each registration has its own connection.
	for _, iface := range []string{portalRequestInterface, shortcutPortalInterface, portalSessionInterface} {
		if err := conn.AddMatchSignalContext(ctx, dbus.WithMatchSender(shortcutPortalBus), dbus.WithMatchInterface(iface)); err != nil {
			return nil, err
		}
	}
	if err := conn.AddMatchSignalContext(ctx, dbus.WithMatchInterface("org.freedesktop.DBus"), dbus.WithMatchMember("NameOwnerChanged"), dbus.WithMatchArg(0, shortcutPortalBus)); err != nil {
		return nil, err
	}
	result, err := shortcutPortalRequest(ctx, conn, signals, "CreateSession", map[string]dbus.Variant{
		"session_handle_token": dbus.MakeVariant("yap_" + strings.ReplaceAll(uuid.NewString(), "-", "")),
	})
	if err != nil {
		if identityErr != nil {
			return nil, fmt.Errorf("%w (desktop identity: %v)", err, identityErr)
		}
		return nil, err
	}
	// The portal specification uses a string here for historical reasons.
	path, ok := result["session_handle"].Value().(string)
	session := dbus.ObjectPath(path)
	if !ok || !session.IsValid() {
		return nil, fmt.Errorf("desktop portal returned an invalid shortcut session")
	}
	stop := make(chan struct{})
	var once sync.Once
	closeSession := func() {
		once.Do(func() {
			close(stop)
			closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			conn.Object(shortcutPortalBus, session).CallWithContext(closeCtx, portalSessionInterface+".Close", 0)
			conn.Close()
		})
	}
	bound := false
	description := ""
	defer func() {
		if !bound {
			closeSession()
		}
	}()
	// Distinct IDs ensure a newly selected combination does not silently reuse
	// the compositor's remembered binding for the previous combination.
	id := "yap_" + strings.ReplaceAll(trigger, "+", "_")
	result, err = shortcutPortalRequest(ctx, conn, signals, "BindShortcuts", session, []portalShortcut{{
		ID: id,
		Options: map[string]dbus.Variant{
			"description":       dbus.MakeVariant("Yap: " + value),
			"preferred_trigger": dbus.MakeVariant(trigger),
		},
	}}, "", map[string]dbus.Variant{})
	if err != nil {
		return nil, err
	}
	var shortcuts []portalShortcut
	if err := dbus.Store([]any{result["shortcuts"].Value()}, &shortcuts); err != nil {
		return nil, fmt.Errorf("desktop portal returned invalid shortcut bindings: %w", err)
	}
	for _, shortcut := range shortcuts {
		if shortcut.ID == id {
			bound = true
			description, _ = shortcut.Options["trigger_description"].Value().(string)
			break
		}
	}
	if !bound {
		return nil, fmt.Errorf("the desktop did not enable %s; allow it in the system shortcut dialog", value)
	}
	shortcut := &Shortcut{done: make(chan struct{})}
	shortcut.closePortal = func() { shortcut.finish(nil); closeSession() }
	go func() {
		err := dispatchPortalShortcut(signals, stop, session, id, description, down, up)
		shortcut.finish(err)
		closeSession()
	}()
	return shortcut, nil
}

func portalShortcutTrigger(value string) (string, error) {
	mods, key, err := ParseShortcut(value)
	if err != nil {
		return "", err
	}
	for i, mod := range mods {
		mods[i] = strings.ToUpper(mod)
	}
	if key == "Space" || len(key) == 1 {
		key = strings.ToLower(key)
	}
	return strings.Join(append(mods, key), "+"), nil
}

func shortcutPortalRequest(ctx context.Context, conn *dbus.Conn, signals <-chan *dbus.Signal, method string, args ...any) (map[string]dbus.Variant, error) {
	return desktopPortalRequest(ctx, conn, signals, shortcutPortalInterface, method, args...)
}

func desktopPortalRequest(ctx context.Context, conn *dbus.Conn, signals <-chan *dbus.Signal, iface, method string, args ...any) (map[string]dbus.Variant, error) {
	options := args[len(args)-1].(map[string]dbus.Variant)
	options["handle_token"] = dbus.MakeVariant("yap_" + strings.ReplaceAll(uuid.NewString(), "-", ""))
	var handle dbus.ObjectPath
	if err := conn.Object(shortcutPortalBus, shortcutPortalPath).CallWithContext(ctx, iface+"."+method, 0, args...).Store(&handle); err != nil {
		return nil, fmt.Errorf("%s: %w", method, err)
	}
	for {
		select {
		case signal, ok := <-signals:
			if !ok {
				return nil, fmt.Errorf("desktop portal disconnected")
			}
			if signal.Path != handle || signal.Name != portalRequestInterface+".Response" {
				continue
			}
			var response uint32
			var result map[string]dbus.Variant
			if err := dbus.Store(signal.Body, &response, &result); err != nil {
				return nil, err
			}
			if response == 1 {
				return nil, fmt.Errorf("%s was cancelled by the desktop: %w", method, context.Canceled)
			}
			if response != 0 {
				return nil, fmt.Errorf("%s was denied by the desktop (response %d)", method, response)
			}
			return result, nil
		case <-ctx.Done():
			closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			conn.Object(shortcutPortalBus, handle).CallWithContext(closeCtx, portalRequestInterface+".Close", 0)
			cancel()
			return nil, fmt.Errorf("%s: %w", method, ctx.Err())
		}
	}
}

func dispatchPortalShortcut(signals <-chan *dbus.Signal, stop <-chan struct{}, session dbus.ObjectPath, id, description string, down, up func()) (resultErr error) {
	held := false
	defer func() {
		if held && resultErr != nil {
			up()
		}
	}()
	for {
		select {
		case <-stop:
			return nil
		case signal, ok := <-signals:
			if !ok {
				return fmt.Errorf("desktop shortcut connection closed; retry the shortcut")
			}
			if signal.Name == portalSessionInterface+".Closed" && signal.Path == session || portalOwnerLost(signal) {
				return fmt.Errorf("desktop shortcut session closed; retry the shortcut")
			}
			if signal.Name == shortcutPortalInterface+".ShortcutsChanged" && len(signal.Body) == 2 && signal.Body[0] == session {
				var shortcuts []portalShortcut
				if err := dbus.Store(signal.Body[1:], &shortcuts); err != nil {
					return fmt.Errorf("desktop returned invalid shortcut changes: %w", err)
				}
				found := false
				for _, shortcut := range shortcuts {
					if shortcut.ID != id {
						continue
					}
					found = true
					current, _ := shortcut.Options["trigger_description"].Value().(string)
					if description != "" && current != description {
						return fmt.Errorf("shortcut changed in desktop settings; record and save it again in Yap")
					}
				}
				if !found {
					return fmt.Errorf("desktop disabled the shortcut; enable it and retry")
				}
				continue
			}
			if signal.Path != shortcutPortalPath || len(signal.Body) < 2 || signal.Body[0] != session || signal.Body[1] != id {
				continue
			}
			pressed := signal.Name == shortcutPortalInterface+".Activated"
			if !pressed && signal.Name != shortcutPortalInterface+".Deactivated" {
				continue
			}
			select {
			case <-stop:
				return nil
			default:
			}
			if pressed != held {
				held = pressed
				if pressed {
					down()
				} else {
					up()
				}
			}
		}
	}
}

func portalOwnerLost(signal *dbus.Signal) bool {
	return signal.Name == "org.freedesktop.DBus.NameOwnerChanged" && len(signal.Body) == 3 && signal.Body[0] == shortcutPortalBus && signal.Body[1] != "" && signal.Body[1] != signal.Body[2]
}
