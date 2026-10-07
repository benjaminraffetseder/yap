//go:build dev

package main

import "github.com/wailsapp/wails/v2/pkg/options"

func singleInstanceLock(*App) *options.SingleInstanceLock {
	// Wails must retain its own child process for backend rebuilds and Vite HMR.
	// Forwarding to another instance exits that child and ends the dev watcher.
	return nil
}
