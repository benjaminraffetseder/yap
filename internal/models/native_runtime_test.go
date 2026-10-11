package models

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestNativeArchiveRejectsTraversal(t *testing.T) {
	for _, name := range []string{"../outside.exe", "bundle/../../outside.exe", "C:/outside.exe", "bundle/..\\..\\outside.exe"} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			archive := filepath.Join(dir, "runtime.zip")
			f, _ := os.Create(archive)
			z := zip.NewWriter(f)
			entry, _ := z.Create(name)
			entry.Write([]byte("binary"))
			z.Close()
			f.Close()
			root := filepath.Join(dir, "extract")
			os.Mkdir(root, 0700)
			if err := extractNativeArchive(context.Background(), archive, root, false, true); err == nil {
				t.Fatal("accepted archive traversal")
			}
		})
	}
}

func TestNativeArchiveMaterializesLocalLibraryLinks(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "runtime.tar.gz")
	f, _ := os.Create(archive)
	gz := gzip.NewWriter(f)
	w := tar.NewWriter(gz)
	w.WriteHeader(&tar.Header{Name: "bundle/lib/library.1.dylib", Typeflag: tar.TypeReg, Size: 7, Mode: 0700})
	w.Write([]byte("library"))
	w.WriteHeader(&tar.Header{Name: "bundle/lib/library.dylib", Typeflag: tar.TypeSymlink, Linkname: "library.1.dylib"})
	w.Close()
	gz.Close()
	f.Close()
	root := filepath.Join(dir, "extract")
	os.Mkdir(root, 0700)
	if err := extractNativeArchive(context.Background(), archive, root, true, true); err != nil {
		t.Fatal(err)
	}
	st, err := os.Lstat(filepath.Join(root, "lib", "library.dylib"))
	if err != nil || !st.Mode().IsRegular() {
		t.Fatal("library link was not safely materialized", err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "lib", "library.dylib"))
	if string(data) != "library" {
		t.Fatal("wrong linked library")
	}
}
