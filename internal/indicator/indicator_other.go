//go:build !windows && (!darwin || !cgo)

package indicator

import "github.com/wailsapp/wails/v3/pkg/application"

func New(*application.App, Actions, string) (Controller, error) { return nil, nil }
