//go:build dev

package main

import "testing"

func TestDevelopmentKeepsItsOwnAppProcess(t *testing.T) {
	if singleInstanceLock(NewApp()) != nil {
		t.Fatal("development must not forward to another app and exit its watcher child")
	}
}
