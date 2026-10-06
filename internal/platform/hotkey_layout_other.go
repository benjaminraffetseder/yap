//go:build !darwin && (windows || cgo)

package platform

import "golang.design/x/hotkey"

func layoutKey(_ string, key hotkey.Key) hotkey.Key { return key }
