package backups

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yap/internal/storage"
)

func TestPreviewTokenAndDeferredDiscardOwnTheArchive(t *testing.T) {
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	path := filepath.Join(t.TempDir(), "backup.zip")
	if _, err := Export(context.Background(), store, path, false); err != nil {
		t.Fatal(err)
	}
	prepared, err := Inspect(context.Background(), store, path)
	if err != nil {
		prepared.Close()
		t.Fatal(err)
	}
	var service Service
	t.Cleanup(func() { service.Close() })
	preview := service.Publish(prepared)
	if _, err := service.Archive("stale-token"); err == nil {
		t.Fatal("a stale preview token acquired the archive")
	}
	if err := service.Discard("stale-token", false); err != nil || !service.HasPreview() {
		t.Fatal("a stale discard changed the current preview", err)
	}
	if err := service.Discard(preview.ID, true); err != nil || !service.HasPreview() {
		t.Fatal("discard closed an archive still in use", err)
	}
	if _, err := service.Archive(preview.ID); err != nil {
		t.Fatal("in-flight restore lost the preview", err)
	}
	service.Finish()
	if service.HasPreview() {
		t.Fatal("finishing the operation retained the deferred preview")
	}
	if _, err := service.Archive(preview.ID); err == nil {
		t.Fatal("consumed preview token remained usable")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal("archive handle remained open", err)
	}
}

func TestCancelledInspectionNeverPublishesAndExportKeepsItsError(t *testing.T) {
	store, err := storage.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	prepared, err := Inspect(ctx, store, filepath.Join(t.TempDir(), "missing.zip"))
	if err == nil {
		t.Fatal("inspection ignored cancellation")
	}
	if err := prepared.Close(); err != nil {
		t.Fatal("failed inspection could not release its resources", err)
	}
	if _, err := Export(ctx, store, filepath.Join(t.TempDir(), "cancelled.zip"), false); err == nil || !strings.Contains(err.Error(), "backup cancelled; no changes were saved") {
		t.Fatal("cancelled export lost its user-visible result", err)
	}
}
