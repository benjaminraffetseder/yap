package fileutil

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicExportPreservesDestinationOnFailure(t *testing.T) {
	for _, failure := range []string{"partial-write", "closed-file", "publication"} {
		t.Run(failure, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "previous.txt")
			os.WriteFile(path, []byte("only surviving copy"), 0600)
			destination := path
			if failure == "publication" {
				destination = dir
			}
			err := writeAtomic(destination, func(f *os.File) error {
				if _, err := f.WriteString("partial replacement"); err != nil {
					return err
				}
				if failure == "partial-write" {
					return errors.New("disk full")
				}
				if failure == "closed-file" {
					return f.Close()
				}
				return nil
			})
			if err == nil {
				t.Fatal("failure ignored")
			}
			got, err := os.ReadFile(path)
			if err != nil || string(got) != "only surviving copy" {
				t.Fatal("old destination lost", string(got), err)
			}
			files, _ := filepath.Glob(filepath.Join(dir, ".yap-export-*"))
			if len(files) != 0 {
				t.Fatal("staging file retained")
			}
		})
	}
}

func TestAtomicExportReplacesDestination(t *testing.T) {
	path := filepath.Join(t.TempDir(), "export.txt")
	os.WriteFile(path, []byte("old"), 0600)
	if err := WriteAtomic(path, []byte("new\n")); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "new\n" {
		t.Fatal(string(got), err)
	}
}
