//go:build !dev

package main

import "github.com/wailsapp/wails/v2/pkg/options"

func singleInstanceLock(app *App) *options.SingleInstanceLock {
	return &options.SingleInstanceLock{
		UniqueId:               "com.yap.desktop",
		OnSecondInstanceLaunch: func(options.SecondInstanceData) { app.show() },
	}
}
