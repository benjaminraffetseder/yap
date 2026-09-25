package platform

import "testing"

func TestShortcutValidation(t *testing.T) {
	for _, v := range []string{"Ctrl+Alt+Space", "Shift+F12", "Ctrl+A"} {
		if _, _, err := ParseShortcut(v); err != nil {
			t.Errorf("valid shortcut %q: %v", v, err)
		}
	}
	for _, v := range []string{"Space", "Ctrl+Ctrl+A", "Ctrl+F13", "Cmd+A", "Ctrl+;", "Alt+"} {
		if _, _, err := ParseShortcut(v); err == nil {
			t.Errorf("accepted invalid shortcut %q", v)
		}
	}
}
