package platform

import (
	"context"
	"os"
	"time"
)

func waylandPasteTarget() string {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	conn, err := connectAccessibilityBus(ctx)
	if err != nil {
		return ""
	}
	defer conn.Close()
	_, _, target, err := accessibleDesktop(ctx, conn, uint32(os.Getpid()))
	if err != nil {
		return ""
	}
	return target
}
