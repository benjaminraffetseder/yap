package tray

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/prop"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

var linuxTrayMain = make(chan func())

func TestMain(m *testing.M) {
	if os.Getenv("YAP_TRAY_SMOKE") != "1" {
		os.Exit(m.Run())
	}
	// Wails records GTK's main thread during package initialization. Go tests
	// run on another goroutine, so keep native App.Run on the original thread.
	runtime.LockOSThread()
	done := make(chan int, 1)
	go func() { done <- m.Run() }()
	for {
		select {
		case run := <-linuxTrayMain:
			run()
		case code := <-done:
			os.Exit(code)
		}
	}
}

func TestLinuxTrayRequiresAvailableHost(t *testing.T) {
	if _, err := exec.LookPath("dbus-daemon"); err != nil {
		t.Skip("dbus-daemon is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "dbus-daemon", "--session", "--nofork", "--print-address=1")
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	address, err := bufio.NewReader(out).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	conn, err := dbus.Connect(strings.TrimSpace(address))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := checkStatusNotifierHost(ctx, conn); err == nil {
		t.Fatal("desktop without a watcher was allowed to hide to tray")
	}
	if _, err := conn.RequestName("org.kde.StatusNotifierWatcher", dbus.NameFlagDoNotQueue); err != nil {
		t.Fatal(err)
	}
	props, err := prop.Export(conn, "/StatusNotifierWatcher", prop.Map{
		"org.kde.StatusNotifierWatcher": {
			"IsStatusNotifierHostRegistered": {Value: false, Writable: true, Emit: prop.EmitTrue},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := checkStatusNotifierHost(ctx, conn); err == nil {
		t.Fatal("watcher without a visible tray host was accepted")
	}
	if err := props.Set("org.kde.StatusNotifierWatcher", "IsStatusNotifierHostRegistered", dbus.MakeVariant(true)); err != nil {
		t.Fatal(err)
	}
	if err := checkStatusNotifierHost(ctx, conn); err != nil {
		t.Fatal("available tray host was rejected", err)
	}
}

// Opt-in: exercises the real StatusNotifier and dbusmenu interfaces without
// touching Yap's data, microphone, clipboard, or global shortcuts.
func TestNativeLinuxTray(t *testing.T) {
	if os.Getenv("YAP_TRAY_SMOKE") != "1" {
		t.Skip("set YAP_TRAY_SMOKE=1 on an unlocked Linux desktop with a tray host")
	}
	icon, err := os.ReadFile("../../build/appicon.png")
	if err != nil {
		t.Fatal(err)
	}
	app := application.New(application.Options{
		Name: "Yap tray smoke test", Linux: application.LinuxOptions{DisableQuitOnLastWindowClosed: true},
	})
	called := make(chan string, 16)
	controller, err := New(app, Actions{
		Show: func() { called <- "show" }, Record: func() { called <- "record" },
		Cancel: func() { called <- "cancel" }, Settings: func() { called <- "settings" },
		Quit: func() { called <- "quit" },
	}, icon)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	result := make(chan error, 1)
	app.OnShutdown(controller.Close)
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go func() {
			result <- exerciseLinuxTray(ctx, controller, called)
			app.Quit()
		}()
	})
	timer := time.AfterFunc(16*time.Second, func() {
		select {
		case result <- fmt.Errorf("Linux tray smoke test timed out"):
		default:
		}
		app.Quit()
	})
	defer timer.Stop()
	runResult := make(chan error, 1)
	linuxTrayMain <- func() { runResult <- app.Run() }
	if err := <-runResult; err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

type linuxTrayMenu struct {
	ID         int32
	Properties map[string]dbus.Variant
	Children   []dbus.Variant
}

func exerciseLinuxTray(ctx context.Context, controller Controller, called <-chan string) error {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return err
	}
	defer conn.Close()
	service := fmt.Sprintf("org.kde.StatusNotifierItem-%d-1", os.Getpid())
	menu := conn.Object(service, "/StatusNotifierMenu")
	readMenu := func() (map[string]linuxTrayMenu, error) {
		var revision uint32
		var root linuxTrayMenu
		if err := menu.CallWithContext(ctx, "com.canonical.dbusmenu.GetLayout", 0, int32(0), int32(-1), []string{}).Store(&revision, &root); err != nil {
			return nil, err
		}
		items := map[string]linuxTrayMenu{}
		for _, child := range root.Children {
			var item linuxTrayMenu
			if err := dbus.Store([]any{child.Value()}, &item); err != nil {
				return nil, err
			}
			if label, ok := item.Properties["label"].Value().(string); ok {
				items[label] = item
			}
		}
		return items, nil
	}
	// Wails starts deferred tray resources asynchronously. Wait for the host's
	// registration and menu export before testing state changes and clicks.
	for {
		var owner string
		var registered dbus.Variant
		ownerErr := conn.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.GetNameOwner", 0, service).Store(&owner)
		hostErr := conn.Object("org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher").CallWithContext(ctx,
			"org.freedesktop.DBus.Properties.Get", 0, "org.kde.StatusNotifierWatcher", "RegisteredStatusNotifierItems").Store(&registered)
		items, _ := registered.Value().([]string)
		found := false
		for _, item := range items {
			found = found || item == service || strings.HasPrefix(item, owner) && strings.HasSuffix(item, "/StatusNotifierItem")
		}
		if _, err := readMenu(); ownerErr == nil && hostErr == nil && found && err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("tray did not register with the desktop host: %w", ctx.Err())
		case <-time.After(20 * time.Millisecond):
		}
	}
	item := conn.Object(service, "/StatusNotifierItem")
	var title dbus.Variant
	if err := item.CallWithContext(ctx, "org.freedesktop.DBus.Properties.Get", 0, "org.kde.StatusNotifierItem", "Title").Store(&title); err != nil || title.Value() != "Yap" {
		return fmt.Errorf("tray has the wrong application title: %v (%v)", title.Value(), err)
	}
	for _, state := range []State{{Phase: "idle", Ready: true}, {Phase: "recording", SaveHistory: true}, {Phase: "transcribing"}, {Phase: "done", Ready: true}} {
		controller.Update(state)
		application.InvokeSync(func() {}) // Drain the queued render.
		items, err := readMenu()
		if err != nil {
			return err
		}
		view := presentation(state)
		if _, ok := items[view.status]; !ok || items[view.record].Properties["enabled"].Value() != view.recordEnabled || items["Cancel"].Properties["enabled"].Value() != view.cancelEnabled {
			return fmt.Errorf("D-Bus menu did not reflect %s: %v", state.Phase, items)
		}
		if checked := items["Save to history"].Properties["toggle-state"].Value(); checked != int32(map[bool]int{false: 0, true: 1}[state.SaveHistory]) {
			return fmt.Errorf("D-Bus history checkbox lost state: %v", checked)
		}
	}
	waitAction := func(want string) error {
		select {
		case got := <-called:
			if got != want {
				return fmt.Errorf("native click dispatched %q, want %q", got, want)
			}
			return nil
		case <-ctx.Done():
			return fmt.Errorf("native click did not dispatch %s: %w", want, ctx.Err())
		}
	}
	if err := menu.CallWithContext(ctx, "com.canonical.dbusmenu.Event", 0, int32(0), "opened", dbus.MakeVariant(int32(0)), uint32(0)).Err; err != nil {
		return err
	}
	if err := item.CallWithContext(ctx, "org.kde.StatusNotifierItem.Activate", 0, int32(0), int32(0)).Err; err != nil {
		return err
	}
	if err := waitAction("show"); err != nil {
		return err
	}
	for _, action := range []struct{ label, want string }{{"Start recording", "record"}, {"Settings", "settings"}, {"Quit Yap", "quit"}} {
		items, err := readMenu()
		if err != nil {
			return err
		}
		if err := menu.CallWithContext(ctx, "com.canonical.dbusmenu.Event", 0, items[action.label].ID, "clicked", dbus.MakeVariant(int32(0)), uint32(0)).Err; err != nil {
			return err
		}
		if err := waitAction(action.want); err != nil {
			return err
		}
	}
	controller.Close()
	controller.Close()
	controller.Update(State{Phase: "recording"})
	return nil
}
