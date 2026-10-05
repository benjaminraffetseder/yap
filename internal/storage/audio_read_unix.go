//go:build !windows

package storage

import (
	"golang.org/x/sys/unix"
	"os"
)

// Nonblocking/no-follow opening prevents a raced FIFO or symlink from hanging.
func openPlaybackFile(root *os.Root, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY|unix.O_NONBLOCK|unix.O_NOFOLLOW, 0)
}
