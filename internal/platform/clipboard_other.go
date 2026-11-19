//go:build !linux || !cgo

package platform

import (
	"context"
	"fmt"
)

func SetClipboard(string) (bool, error) { return false, nil }
func CloseClipboard()                   {}

func pasteWaylandClipboard() error {
	return fmt.Errorf("Wayland clipboard requires a CGO-enabled Linux build")
}

func SetClipboardContext(context.Context, string) (bool, error) { return false, nil }
