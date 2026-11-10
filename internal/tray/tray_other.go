//go:build !windows && !darwin && !linux

package tray

import "github.com/wailsapp/wails/v3/pkg/application"

// Unsupported desktops close normally instead of hiding without a usable tray.
func New(*application.App, Actions, []byte) (Controller, error) { return nil, nil }
