//go:build windows

package platform

import "golang.design/x/hotkey"

func altModifier() hotkey.Modifier { return hotkey.ModAlt }
