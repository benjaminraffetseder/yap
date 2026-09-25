package platform

import (
	"fmt"
	"strings"
)

func ParseShortcut(value string) ([]string, string, error) {
	parts := strings.Split(value, "+")
	if len(parts) < 2 {
		return nil, "", fmt.Errorf("use a modifier and a key, such as Ctrl+Alt+Space")
	}
	mods := []string{}
	seen := map[string]bool{}
	for _, m := range parts[:len(parts)-1] {
		if m != "Ctrl" && m != "Alt" && m != "Shift" {
			return nil, "", fmt.Errorf("supported modifiers: Ctrl, Alt, Shift")
		}
		if seen[m] {
			return nil, "", fmt.Errorf("duplicate modifier %s", m)
		}
		seen[m] = true
		mods = append(mods, m)
	}
	key := parts[len(parts)-1]
	valid := key == "Space" || len(key) == 1 && key[0] >= 'A' && key[0] <= 'Z'
	for i := 1; i <= 12; i++ {
		if key == fmt.Sprintf("F%d", i) {
			valid = true
		}
	}
	if !valid {
		return nil, "", fmt.Errorf("use Space, A–Z, or F1–F12")
	}
	return mods, key, nil
}
