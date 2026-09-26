package main

import (
	"context"
	"embed"
	"log"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	config := &options.App{
		Title:            "Yap — Local dictation",
		Width:            1100,
		Height:           760,
		MinWidth:         760,
		MinHeight:        560,
		BackgroundColour: &options.RGBA{R: 250, G: 250, B: 250, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []interface{}{app},
	}
	if runtime.GOOS == "darwin" {
		// CGO hotkeys and the status panel use AppKit's main queue. Clean up
		// while the event loop is still running, before Wails calls OnShutdown.
		config.OnBeforeClose = func(ctx context.Context) bool { app.shutdown(ctx); return false }
	}
	if err := wails.Run(config); err != nil {
		log.Fatal(err)
	}
}
