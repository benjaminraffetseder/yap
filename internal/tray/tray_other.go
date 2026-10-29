//go:build !windows && !darwin

package tray

import "github.com/wailsapp/wails/v3/pkg/application"

// Linux desktop tray availability still needs native verification. Preserve
// window-close-as-exit there instead of hiding an app without a usable tray.
func New(*application.App, Actions, []byte) (Controller, error) { return nil, nil }
