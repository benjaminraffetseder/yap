package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	if err := wails.Run(&options.App{
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
	}); err != nil {
		log.Fatal(err)
	}
}
