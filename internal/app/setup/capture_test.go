package setup

import (
	"context"
	"errors"
	"os"
	"reflect"
	"testing"

	"yap/internal/storage"
)

type failedCapture struct{ err error }

func (capture failedCapture) Start(string, string, func(float64)) error { return capture.err }
func (failedCapture) Stop() (int64, error)                              { return 0, nil }

func TestCaptureFailurePublishesBeforeCleanupAndReleasesTheFile(t *testing.T) {
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	var calls []string
	discard := func(path string) error {
		calls = append(calls, "discard")
		return os.Remove(path)
	}
	capture, err := PrepareCapture(store.CreateRecording, discard)
	if err != nil {
		t.Fatal(err)
	}
	startErr := errors.New("microphone denied")
	err = capture.Start(failedCapture{startErr}, "", nil, func() { calls = append(calls, "publish") }, discard)
	if !errors.Is(err, startErr) || !reflect.DeepEqual(calls, []string{"publish", "discard"}) {
		t.Fatalf("capture failure changed ordering or error: %v, %v", calls, err)
	}
	if _, err := os.Stat(capture.Path()); !os.IsNotExist(err) {
		t.Fatal("failed capture retained its file", err)
	}
}

func TestDiagnosticCleanupFailureOverridesCancellationAndNeverExposesText(t *testing.T) {
	settings := storage.Defaults()
	result := CompleteDiagnostic(context.Canceled, "Private recognized text", errors.New("engine error"), nil, settings, nil, 1000)
	if result.Phase != "cancelled" || result.Transcript != "" || result.Details != "" {
		t.Fatalf("cancellation did not take precedence: %+v", result)
	}
	cleanupErr := errors.New("audio still in use")
	result = CompleteDiagnostic(context.Canceled, "Private recognized text", nil, cleanupErr, settings, nil, 1000)
	if result.Phase != "error" || result.Details != cleanupErr.Error() || result.Transcript != "" {
		t.Fatalf("cleanup failure was hidden by cancellation: %+v", result)
	}
	if err := ValidateComplete(true, settings, false, false, "shortcut unavailable"); err != nil {
		t.Fatal("explicit setup skip tried to validate unavailable devices", err)
	}
}
