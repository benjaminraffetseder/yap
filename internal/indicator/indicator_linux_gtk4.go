//go:build linux && cgo && !gtk3

package indicator

// #cgo pkg-config: gtk4
import "C"
