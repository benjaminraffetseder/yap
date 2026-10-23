package platform

import (
	"strings"
	"testing"
)

// Enumerating apps and reading focus never activates a window or sends input.
func TestWindowsApplicationsHaveUniqueExecutableIdentities(t *testing.T) {
	apps, err := Applications()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, app := range apps {
		if app.Name == "" || strings.HasSuffix(strings.ToLower(app.Name), ".exe") || !strings.HasPrefix(app.ID, "windows:"+strings.ToLower(app.Name)) || seen[app.ID] {
			t.Fatal("invalid application identity", app)
		}
		seen[app.ID] = true
	}
	if id := ActiveApplication(); id != "" && (!strings.HasPrefix(id, "windows:") || id != strings.ToLower(id)) {
		t.Fatal("invalid active application", id)
	}
}
