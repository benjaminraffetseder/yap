package models

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBundleRuntimeRelocation(t *testing.T) {
	root := t.TempDir()
	app := filepath.Join(root, "New Location", "Yap.app", "Contents")
	executable := filepath.Join(app, "MacOS", "Yap")
	cli := filepath.Join(app, "Resources", "whisper", "whisper-cli")
	if err := os.MkdirAll(filepath.Dir(cli), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cli, []byte("#!/bin/sh\n"), 0700); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(root, "Old Location", "Yap.app", "Contents", "Resources", "whisper", "whisper-cli")
	custom := filepath.Join(root, "custom", "whisper-cli")
	for _, current := range []string{"", old, cli} {
		if got := preferredBundleRuntime(executable, current); got != cli {
			t.Fatalf("bundle path %q did not resolve after relocation: %q", current, got)
		}
	}
	if got := preferredBundleRuntime(executable, custom); got != custom {
		t.Fatal("overrode explicitly selected runtime")
	}
	if err := os.Chmod(cli, 0600); err != nil {
		t.Fatal(err)
	}
	if got := preferredBundleRuntime(executable, old); got != old {
		t.Fatal("accepted a non-executable runtime")
	}
	if got := preferredBundleRuntime(filepath.Join(root, "unbundled", "Yap"), ""); got != "" {
		t.Fatal("resolved outside app bundle")
	}
}
