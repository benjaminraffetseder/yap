//go:build linux && cgo

package platform

import "golang.design/x/hotkey"

func altModifier() hotkey.Modifier { return hotkey.Mod1 }
