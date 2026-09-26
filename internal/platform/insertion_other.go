//go:build !windows && !darwin

package platform

import (
	"fmt"
	"os/exec"
	"strings"
)

func Target() string {
	cmd := exec.Command("xdotool", "getwindowfocus")
	data, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
func Paste(target string) error {
	if target == "" || Target() != target {
		return fmt.Errorf("target application unavailable or focus changed; paste from the clipboard")
	}
	cmd := exec.Command("xdotool", "key", "--clearmodifiers", "ctrl+v")
	return cmd.Run()
}
