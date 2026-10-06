//go:build darwin && cgo

package platform

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit -framework ApplicationServices
#include <stdint.h>
uint64_t yap_paste_target(void);
int yap_paste(uint64_t target);
*/
import "C"

import (
	"fmt"
	"strconv"
)

func Target() string {
	target := uint64(C.yap_paste_target())
	if target == 0 {
		return ""
	}
	return strconv.FormatUint(target, 10)
}

func Paste(target string) error {
	identity, err := strconv.ParseUint(target, 10, 64)
	if err != nil || identity == 0 {
		return fmt.Errorf("target application unavailable; paste from the clipboard")
	}
	switch C.yap_paste(C.uint64_t(identity)) {
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
