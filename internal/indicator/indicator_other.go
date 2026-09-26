//go:build !windows

package indicator

func New(Actions) (Controller, error) { return nil, nil }
