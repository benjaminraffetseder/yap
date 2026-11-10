//go:build !windows && !darwin

package platform

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func waylandSession() bool {
	sessionType := os.Getenv("XDG_SESSION_TYPE")
	return sessionType == "wayland" || (sessionType == "" && os.Getenv("WAYLAND_DISPLAY") != "")
}

func Target() string {
	if waylandSession() {
		return waylandPasteTarget()
	}
	cmd := exec.Command("xdotool", "getwindowfocus")
	data, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
func Paste(target string) error {
	if waylandSession() {
		if target == "" || !strings.HasPrefix(target, "wayland:") || Target() != target {
			return fmt.Errorf("target application unavailable or focus changed; paste from the clipboard")
		}
		return pasteWaylandClipboard()
	}
	if target == "" || Target() != target {
		return fmt.Errorf("target application unavailable or focus changed; paste from the clipboard")
	}
	cmd := exec.Command("xdotool", "key", "--clearmodifiers", "ctrl+v")
	return cmd.Run()
}
