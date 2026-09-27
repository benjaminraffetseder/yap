//go:build !windows && (!darwin || !cgo)

package indicator

func New(Actions, string) (Controller, error) { return nil, nil }
