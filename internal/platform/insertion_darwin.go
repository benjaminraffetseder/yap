//go:build darwin && cgo

package platform

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit -framework ApplicationServices
int yap_frontmost_pid(void);
int yap_paste(int target);
*/
import "C"

import (
	"fmt"
	"strconv"
)

func Target() string {
	pid := int(C.yap_frontmost_pid())
	if pid <= 0 {
		return ""
	}
	return strconv.Itoa(pid)
}

func Paste(target string) error {
	pid, err := strconv.Atoi(target)
	if err != nil || pid <= 0 {
		return fmt.Errorf("target application unavailable; paste from the clipboard")
	}
	switch C.yap_paste(C.int(pid)) {
	case 0:
		return nil
	case 1:
		return fmt.Errorf("target application unavailable or focus changed; paste from the clipboard")
	case 2:
		return fmt.Errorf("allow Yap in System Settings → Privacy & Security → Accessibility to paste automatically; transcript copied to clipboard")
	default:
		return fmt.Errorf("could not send paste; transcript copied to clipboard")
	}
}
