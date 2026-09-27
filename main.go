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

//go:embed build/windows/icon.ico
var trayIcon []byte

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
		OnBeforeClose:    app.beforeClose,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "com.yap.desktop",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) { app.show() },
		},
		Bind: []interface{}{app},
	}
	if err := wails.Run(config); err != nil {
		log.Fatal(err)
	}
}
