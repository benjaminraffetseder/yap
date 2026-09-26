//go:build darwin && !cgo

package platform

import "fmt"

func Target() string { return "" }
func Paste(string) error {
	return fmt.Errorf("macOS insertion requires a CGO-enabled build; paste from the clipboard")
}
