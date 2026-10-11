//go:build darwin || linux

package speech

import "github.com/ebitengine/purego"

func openMoonshine(path string) (uintptr, func(), error) {
	h, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_LOCAL)
	return h, func() { _ = purego.Dlclose(h) }, err
}
