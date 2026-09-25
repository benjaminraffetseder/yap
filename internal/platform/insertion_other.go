//go:build !windows

package platform

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

func Target() string {
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		cmd = exec.Command("osascript", "-e", `tell application "System Events" to get unix id of first process whose frontmost is true`)
	} else {
		cmd = exec.Command("xdotool", "getwindowfocus")
	}
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
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		cmd = exec.Command("osascript", "-e", `tell application "System Events" to keystroke "v" using command down`)
	} else {
		cmd = exec.Command("xdotool", "key", "--clearmodifiers", "ctrl+v")
	}
	return cmd.Run()
}
