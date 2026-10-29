//go:build !windows

package indicator

import "github.com/wailsapp/wails/v3/pkg/application"

func WindowsOptions() application.WindowsOptions { return application.WindowsOptions{} }
