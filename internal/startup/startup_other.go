//go:build !windows && !darwin && !linux

package startup

func New() (Controller, error) { return nil, nil }
