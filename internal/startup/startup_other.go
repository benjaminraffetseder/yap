//go:build !windows && !darwin

package startup

func New() (Controller, error) { return nil, nil }
