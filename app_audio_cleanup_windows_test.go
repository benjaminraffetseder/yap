package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
	"yap/internal/storage"
)

func denyAudioDeletion(t *testing.T, path string) func() {
	t.Helper()
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	return func() {
		if !closed {
			closed = true
			windows.CloseHandle(h)
		}
	}
}

func TestDiscardedAudioDeletionFailureIsVisibleAndRetriesAfterRestart(t *testing.T) {
	for _, kind := range []string{"diagnostic", "microphone", "dictation"} {
		t.Run(kind, func(t *testing.T) {
			a := diagnosticApp(t)
			var err error
			switch kind {
			case "diagnostic":
				err = a.StartDiagnosticTest()
			case "microphone":
				err = a.StartMicrophoneTest()
			default:
				err = a.StartRecording()
			}
			if err != nil {
				t.Fatal(err)
			}
			path, dir := a.path, a.store.Dir
			release := denyAudioDeletion(t, path)
			if err = a.Cancel(); err == nil {
				release()
				t.Fatal("cleanup denial reported success")
			}
			if !strings.Contains(a.status.HistoryError, "temporary audio") {
				release()
				t.Fatal("cleanup denial hidden")
			}
			a.shutdown(context.Background())
			release()
			reopened, err := storage.Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if _, err = reopened.PruneHistory(0, time.Now()); err != nil {
				t.Fatal(err)
			}
			if _, err = os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("discarded audio survived restart recovery", err)
			}
		})
	}
}

func TestUnretainedSuccessfulDictationReportsCleanupFailure(t *testing.T) {
	a := testApp(t)
	if err := a.StartRecording(); err != nil {
		t.Fatal(err)
	}
	path := a.path
	release := denyAudioDeletion(t, path)
	defer release()
	if err := a.StopRecording(); err != nil {
		t.Fatal(err)
	}
	a.wg.Wait()
	snapshot, err := a.GetSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Status.Phase != "done" || snapshot.Status.HistoryError == "" {
		t.Fatalf("successful text/cleanup warning lost: %+v", snapshot.Status)
	}
	if len(snapshot.History) != 1 || snapshot.History[0].AudioPath != "" {
		t.Fatal("failed deletion changed retention policy")
	}
	release()
	if err = a.store.RecoverPendingDeletes(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("cleanup retry left audio", err)
	}
}
