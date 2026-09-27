package indicator

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPositionPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "indicator-position.json")
	if _, exists, err := loadPosition(path); exists || err != nil {
		t.Fatalf("missing position: %v, %v", exists, err)
	}
	for _, want := range []point{{-1200, 64}, {0, 0}, {800, -300}} {
		if err := savePosition(path, want); err != nil {
			t.Fatal(err)
		}
		got, exists, err := loadPosition(path)
		if err != nil || !exists || got != want {
			t.Fatalf("position did not persist: %+v, %v", got, err)
		}
	}
	files, err := os.ReadDir(filepath.Dir(path))
	if err != nil || len(files) != 1 {
		t.Fatalf("temporary position files leaked: %v, %v", files, err)
	}
}

func TestInvalidPositionIsNotRestored(t *testing.T) {
	path := filepath.Join(t.TempDir(), "indicator-position.json")
	for _, raw := range []string{`null`, `{}`, `{"x":20}`, `{"x":null,"y":0}`, `{"x":"20","y":0}`, `{"x":2147483648,"y":0}`, `{"x":0.5,"y":0}`, `not json`} {
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, exists, err := loadPosition(path); exists || err == nil {
			t.Fatalf("restored invalid position: %s", raw)
		}
	}
}

func TestPositionWriteFailureDoesNotLeavePartialFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "blocked.json")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := savePosition(path, point{100, 100}); err == nil {
		t.Fatal("ignored a failed position write")
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 1 || !files[0].IsDir() {
		t.Fatalf("partial position files remain: %v, %v", files, err)
	}
}
