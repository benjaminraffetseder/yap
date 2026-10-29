//go:build !dev

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func singleInstanceLock(app *App) *application.SingleInstanceOptions {
	return &application.SingleInstanceOptions{
		UniqueID:               "com.yap.desktop",
		OnSecondInstanceLaunch: func(application.SecondInstanceData) { app.show() },
	}
}
