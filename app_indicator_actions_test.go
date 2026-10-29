package main

import (
	"os"
	"testing"
)

func TestIndicatorActionsCannotAffectANewerRecording(t *testing.T) {
	for _, action := range []string{"stop", "cancel"} {
		t.Run(action, func(t *testing.T) {
			a := testApp(t)
			a.settings.AutoCopy = false
			if err := a.StartRecording(); err != nil {
				t.Fatal(err)
			}
			old := a.id
			if err := a.Cancel(); err != nil {
				t.Fatal(err)
			}
			if err := a.StartRecording(); err != nil {
				t.Fatal(err)
			}
			current, path := a.id, a.path
			if action == "stop" {
				a.indicatorStop(old)
			} else {
				a.indicatorCancel(old)
			}
			if a.id != current || a.status.Phase != "recording" {
				t.Fatal("old action changed the new recording")
			}
			if _, err := os.Stat(path); err != nil {
				t.Fatal("old action removed the new audio", err)
			}
			if action == "stop" {
				a.indicatorStop(current)
				a.wg.Wait()
				if a.status.Phase != "done" {
					t.Fatal("current Stop was ignored")
				}
			} else {
				a.indicatorCancel(current)
				if a.status.Phase != "idle" {
					t.Fatal("current Cancel was ignored")
				}
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Fatal("current Cancel retained the recording")
				}
			}
		})
	}
}

func TestIndicatorCancelCannotCancelAnUnrelatedOperation(t *testing.T) {
	a := testApp(t)
	a.id = "completed-recording"
	a.status.Phase = "downloading"
	cancelled := false
	a.cancel = func() { cancelled = true }
	a.indicatorCancel(a.id)
	a.indicatorCancel("")
	if cancelled || a.status.Phase != "downloading" {
		t.Fatal("old indicator cancelled an unrelated operation")
	}
}
