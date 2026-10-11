package main

import (
	"embed"
	"fmt"
	"log"
	"os"

	"yap/internal/inference/speech"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/windows/icon.ico
var trayIcon []byte

func main() {
	if handled, err := speech.RunWorker(os.Args[1:]); handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	app := NewApp()
	config := &options.App{
		Title:              "Yap",
		Width:              1100,
		Height:             760,
		MinWidth:           760,
		MinHeight:          560,
		BackgroundColour:   &options.RGBA{R: 250, G: 250, B: 250, A: 255},
		AssetServer:        &assetserver.Options{Assets: assets},
		DragAndDrop:        &options.DragAndDrop{EnableFileDrop: true},
		OnStartup:          app.startup,
		StartHidden:        true,
		OnDomReady:         app.onDomReady,
		OnShutdown:         app.shutdown,
		OnBeforeClose:      app.beforeClose,
		SingleInstanceLock: singleInstanceLock(app),
		Bind:               []interface{}{app},
	}
	if err := wails.Run(config); err != nil {
		log.Fatal(err)
	}
}
