package models

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Discover the bundle from the executable, never the working directory or PATH.
// Refresh a saved bundle path when the user moves/upgrades Yap.app; retain an
// explicitly selected external runtime.
func PreferredRuntime(current string) string {
	if runtime.GOOS != "darwin" {
		return current
	}
	executable, err := os.Executable()
	if err != nil {
		return current
	}
	return preferredBundleRuntime(executable, current)
}

func preferredBundleRuntime(executable, current string) string {
	macOS := filepath.Dir(executable)
	contents := filepath.Dir(macOS)
	if filepath.Base(macOS) != "MacOS" || filepath.Base(contents) != "Contents" || filepath.Ext(filepath.Dir(contents)) != ".app" {
		return current
	}
	candidate := filepath.Join(contents, "Resources", "whisper", "whisper-cli")
	if _, err := exec.LookPath(candidate); err != nil {
		return current
	}
	if current == "" || isBundledRuntime(current) {
		return candidate
	}
	return current
}

func isBundledRuntime(path string) bool {
	whisper := filepath.Dir(path)
	resources := filepath.Dir(whisper)
	contents := filepath.Dir(resources)
	return filepath.Base(path) == "whisper-cli" && filepath.Base(whisper) == "whisper" && filepath.Base(resources) == "Resources" && filepath.Base(contents) == "Contents" && filepath.Ext(filepath.Dir(contents)) == ".app"
}
