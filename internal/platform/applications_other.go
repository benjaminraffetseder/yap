//go:build !windows && (!darwin || !cgo)

package platform

import "fmt"

func ActiveApplication() string { return "" }
func Applications() ([]Application, error) {
	return nil, fmt.Errorf("application rules require Windows or a native macOS build")
}
