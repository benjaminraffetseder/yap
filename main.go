package main

import (
	"embed"
	"fmt"
	"log"
	"os"

	"yap/internal/inference/speech"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var trayIcon []byte

func main() {
	if handled, err := speech.RunWorker(os.Args[1:]); handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	service := NewApp()
	app := application.New(application.Options{
		Name:           "Yap",
		Mac:            application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		Services:       []application.Service{application.NewService(service)},
		Assets:         application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		SingleInstance: singleInstanceLock(service),
		OnShutdown:     func() { service.shutdown(service.ctx) },
	})
	service.desktop = app
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "Yap", URL: "/",
		Width: 1100, Height: 760, MinWidth: 760, MinHeight: 560,
		BackgroundColour: application.RGBA{Red: 250, Green: 250, Blue: 250, Alpha: 255},
		Hidden:           true, EnableFileDrop: true,
	})
	service.window = window
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		service.onDomReady(service.ctx)
	})
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if service.beforeClose(service.ctx) {
			event.Cancel()
		}
	})
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		app.Event.Emit("audio:files-dropped", event.Context().DroppedFiles())
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
