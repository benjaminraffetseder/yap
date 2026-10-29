//go:build dev

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func singleInstanceLock(*App) *application.SingleInstanceOptions {
	// Wails must retain its own child process for backend rebuilds and Vite HMR.
	// Forwarding to another instance exits that child and ends the dev watcher.
	return nil
}
