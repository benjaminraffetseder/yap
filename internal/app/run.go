package app

import (
	"io/fs"

	"yap/internal/indicator"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Options supplies the embedded assets and release metadata from the entry point.
type Options struct {
	Assets           fs.FS
	Icon             []byte
	Version          string
	UpdateRepository string
}

// Run configures the desktop application and runs its native event loop.
func Run(options Options) error {
	service := newApp(options)
	desktop := application.New(application.Options{
		Name:           "Yap",
		Icon:           options.Icon,
		Mac:            application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		Windows:        indicator.WindowsOptions(),
		Linux:          application.LinuxOptions{ApplicationID: "com.yap.desktop", ProgramName: "com.yap.desktop"},
		Services:       []application.Service{application.NewService(service)},
		Assets:         application.AssetOptions{Handler: application.AssetFileServerFS(options.Assets)},
		SingleInstance: singleInstanceLock(service),
		ShouldQuit:     service.shouldQuit,
		OnShutdown:     func() { service.shutdown(service.ctx) },
	})
	service.desktop = desktop
	if err := service.configureUpdater(desktop.Updater); err != nil {
		return err
	}
	window := desktop.Window.NewWithOptions(application.WebviewWindowOptions{
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
		// Deliver only to this webview; native GTK drops have no DOM drop event.
		// Broadcasting would also import in attached development browser previews.
		window.DispatchWailsEvent(&application.CustomEvent{
			Name: "audio:files-dropped", Data: event.Context().DroppedFiles(),
		})
	})
	return desktop.Run()
}
