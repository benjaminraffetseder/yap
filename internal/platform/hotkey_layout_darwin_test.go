//go:build darwin && cgo

package platform

import (
	"golang.design/x/hotkey"
	"testing"
)

func TestLetterShortcutsUseLogicalLayoutKeys(t *testing.T) {
	for ch := byte('A'); ch <= 'Z'; ch++ {
		if got := layoutKey(string(ch), hotkey.KeyA); got != hotkey.LogicalLetterKey(ch) {
			t.Fatal(ch, got)
		}
	}
	if layoutKey("Space", hotkey.KeySpace) != hotkey.KeySpace || layoutKey("F1", hotkey.KeyF1) != hotkey.KeyF1 {
		t.Fatal("non-letter key changed")
	}
}
