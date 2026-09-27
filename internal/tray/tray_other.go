//go:build !windows && (!darwin || !cgo)

package tray

func New(Actions, []byte) (Controller, error) { return nil, nil }
