package main

import (
	"context"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"golang.org/x/sys/windows"
)

func TestNativeShutdown(t *testing.T) {
	if os.Getenv("YAP_SHUTDOWN_SMOKE") != "1" {
		t.Skip("set YAP_SHUTDOWN_SMOKE=1 for the Wails UI-thread shutdown regression")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED); err != nil {
		t.Fatal(err)
	}
	defer windows.CoUninitialize()
	a := NewApp()
	a.ctx = context.Background()
	locked, release := make(chan struct{}), make(chan struct{})
	var released sync.Once
	var uiRan atomic.Bool
	desktop := application.New(application.Options{
		Name: "Yap shutdown test",
		ShouldQuit: func() bool {
			allowed := a.shouldQuit()
			released.Do(func() { close(release) })
			return allowed
		},
		OnShutdown: func() { a.shutdown(a.ctx) },
	})
	a.quitApplication = desktop.Quit
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.mu.Lock()
		defer a.mu.Unlock()
		close(locked)
		<-release
		// Clipboard.SetText uses the same UI dispatch while App.mu is held.
		// Exercise that ordering without reading or changing the real clipboard.
		application.InvokeSync(func() { uiRan.Store(true) })
	}()
	desktop.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) { <-locked; desktop.Quit() })
	if err := desktop.Run(); err != nil {
		t.Fatal(err)
	}
	if !uiRan.Load() || !a.shutdownComplete.Load() {
		t.Fatal("Wails exited before GUI-dependent work drained")
	}
}
