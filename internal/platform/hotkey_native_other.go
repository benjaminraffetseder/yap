//go:build !linux && (windows || cgo)

package platform

import "context"

func registerWaylandShortcut(string, func(), func()) (*Shortcut, error) { return nil, nil }

func registerWaylandShortcutContext(context.Context, string, func(), func()) (*Shortcut, error) {
	return nil, nil
}
