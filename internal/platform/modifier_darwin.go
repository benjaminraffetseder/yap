//go:build darwin && cgo

package platform

import "golang.design/x/hotkey"

func altModifier() hotkey.Modifier { return hotkey.ModOption }
