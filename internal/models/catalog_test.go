package models

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestMediumAndLargeModelsUseManagedLifecycle(t *testing.T) {
	for _, id := range []string{"medium", "large-v3"} {
		t.Run(id, func(t *testing.T) {
			dir := t.TempDir()
			var model *Model
			for _, entry := range List(dir) {
				if entry.ID == id {
					model = &entry
					break
				}
			}
			if model == nil {
				t.Fatalf("%s missing from downloadable models", id)
			}
			if model.Installed || model.Removable || model.Path != "" {
				t.Fatal("new model marked installed", model)
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			path, err := Install(ctx, dir, id, func(int64, int64) {})
			want := filepath.Join(dir, "models", "ggml-"+id+".bin")
			if !errors.Is(err, context.Canceled) || path != want {
				t.Fatalf("model not accepted by installer: %s %v", path, err)
			}
			if err := os.MkdirAll(filepath.Dir(want), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(want, []byte("incomplete download"), 0600); err != nil {
				t.Fatal(err)
			}
			for _, entry := range List(dir) {
				if entry.ID == id && (entry.Installed || !entry.Removable || entry.Path != want) {
					t.Fatalf("incomplete model not repairable: %+v", entry)
				}
			}
			if err := Remove(dir, id, want); err == nil {
				t.Fatal("removed selected model")
			}
			if err := Remove(dir, id, ""); err != nil {
				t.Fatal("cannot remove incomplete model", err)
			}
			if _, err := os.Stat(want); !os.IsNotExist(err) {
				t.Fatal("model file remains", err)
			}
		})
	}
}
