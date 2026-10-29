package tray

import (
	"fmt"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Opt-in: runs a tray-only Wails application with no Yap data, microphone,
// clipboard, or shortcut registration. Wails owns all native resources.
func TestNativeTray(t *testing.T) {
	if os.Getenv("YAP_TRAY_SMOKE") != "1" {
		t.Skip("set YAP_TRAY_SMOKE=1 on an unlocked Windows desktop")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	icon, err := os.ReadFile("../../build/appicon.png")
	if err != nil {
		t.Fatal(err)
	}
	app := application.New(application.Options{
		Name:    "Yap tray smoke test",
		Windows: application.WindowsOptions{DisableQuitOnLastWindowClosed: true},
	})
	controller, err := New(app, Actions{}, icon)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	app.OnShutdown(controller.Close)
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		defer app.Quit()
		native := controller.(*wailsTray)
		for _, state := range []State{{Phase: "idle", Ready: true}, {Phase: "recording", SaveHistory: true}, {Phase: "transcribing"}, {Phase: "closing"}} {
			controller.Update(state)
			application.InvokeSync(func() {
				view := presentation(state)
				if native.record.Label() != view.record || native.record.Enabled() != view.recordEnabled || native.cancel.Enabled() != view.cancelEnabled || native.history.Checked() != state.SaveHistory {
					t.Errorf("native menu lost state: %+v", state)
				}
			})
		}
		controller.Close()
		controller.Close()
		controller.Update(State{Phase: "recording"})
		result <- nil
	})
	timeout := time.AfterFunc(15*time.Second, func() {
		select {
		case result <- fmt.Errorf("Wails tray lifecycle timed out"):
		default:
		}
		app.Quit()
	})
	defer timeout.Stop()
	if err := app.Run(); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}
