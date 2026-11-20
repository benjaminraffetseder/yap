//go:build dev

package app

import "testing"

func TestDevelopmentKeepsItsOwnAppProcess(t *testing.T) {
	if singleInstanceLock(newApp(Options{})) != nil {
		t.Fatal("development must not forward to another app and exit its watcher child")
	}
}
