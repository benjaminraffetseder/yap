package modelmanagement

import (
	"context"
	"errors"
	"testing"

	textmodel "yap/internal/inference/text"
)

func TestRemovalPreservesTheSelectedModelAndReleasesOthersBeforeValidation(t *testing.T) {
	released := false
	config := textmodel.Config{Provider: "builtin", Model: "selected"}
	if err := RemoveText(t.TempDir(), "selected", config, func() { released = true }); err == nil || released {
		t.Fatal("removing the selected model released its active connection", err)
	}
	if err := RemoveText(t.TempDir(), "unknown-model", config, func() { released = true }); err == nil || !released {
		t.Fatal("other removal did not release the connection before filesystem validation", err)
	}
	if _, err := PrepareSpeech("unknown-model"); err == nil || err.Error() != "unknown model" {
		t.Fatal("speech installation accepted an unknown model", err)
	}
	if _, err := PrepareText("unknown-model"); err == nil || err.Error() != "unknown text model" {
		t.Fatal("text installation lost model-validation priority", err)
	}
}

func TestAudioDownloadCancellationWinsOverTheInstallerError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	outcome := CompleteAudio(ctx, errors.New("download failed"))
	if outcome.Err != nil || outcome.Phase != "idle" || outcome.Message != "Audio support download cancelled" {
		t.Fatalf("cancelled download surfaced an installation error: %+v", outcome)
	}
}
