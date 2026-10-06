//go:build darwin && cgo

package platform

import "golang.design/x/hotkey"

func layoutKey(name string, key hotkey.Key) hotkey.Key {
	if len(name) == 1 && name[0] >= 'A' && name[0] <= 'Z' {
		return hotkey.LogicalLetterKey(name[0])
	}
	return key
}
