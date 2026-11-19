//go:build windows || darwin

package tray

func checkTraySupport() error { return nil }
