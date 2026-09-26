//go:build !windows && (!darwin || !cgo)

package indicator

func New(Actions) (Controller, error) { return nil, nil }
