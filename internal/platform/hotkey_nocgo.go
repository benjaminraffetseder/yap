//go:build !windows && !cgo

package platform

import "fmt"

type Shortcut struct{}

func Register(value string, down, up func()) (*Shortcut, error) {
	return nil, fmt.Errorf("global shortcuts on this platform require a CGO-enabled build")
}
func (s *Shortcut) Close() {}
