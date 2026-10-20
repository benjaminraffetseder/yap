package platform

import (
	"sort"
	"strings"
)

type Application struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func sortedApplications(apps map[string]Application) []Application {
	result := make([]Application, 0, len(apps))
	for _, app := range apps {
		result = append(result, app)
	}
	sort.Slice(result, func(i, j int) bool {
		left, right := strings.ToLower(result[i].Name), strings.ToLower(result[j].Name)
		if left == right {
			return result[i].ID < result[j].ID
		}
		return left < right
	})
	return result
}

// Modifier order does not distinguish two registrations of the same shortcut.
func SameShortcut(left, right string) bool {
	lm, lk, le := ParseShortcut(left)
	rm, rk, re := ParseShortcut(right)
	if le != nil || re != nil || lk != rk || len(lm) != len(rm) {
		return false
	}
	sort.Strings(lm)
	sort.Strings(rm)
	return strings.Join(lm, "+") == strings.Join(rm, "+")
}
