//go:build !linux && !windows && !darwin

package platform

func waylandPasteTarget() string { return "" }
