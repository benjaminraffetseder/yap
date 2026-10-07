//go:build !dev

package main

import (
	"testing"

	"github.com/wailsapp/wails/v2/pkg/options"
)

func TestReleaseRetainsSingleInstanceReopen(t *testing.T) {
	app := NewApp()
	shown := 0
	app.showWindow = func() { shown++ }
	lock := singleInstanceLock(app)
	if lock == nil || lock.UniqueId != "com.yap.desktop" || lock.OnSecondInstanceLaunch == nil {
		t.Fatal("packaged builds must retain the shared application lock")
	}
	lock.OnSecondInstanceLaunch(options.SecondInstanceData{})
	if shown != 1 || !app.windowRequested {
		t.Fatal("second launch must reopen the running packaged application")
	}
}
