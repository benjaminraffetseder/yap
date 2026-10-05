package fileutil

import (
	"os"
	"path/filepath"
)

// WriteAtomic preserves an existing destination until all writes and close succeed.
func WriteAtomic(path string, data []byte) error {
	return writeAtomic(path, func(f *os.File) error { _, err := f.Write(data); return err })
}

func writeAtomic(path string, write func(*os.File) error) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".yap-export-*")
	if err != nil {
		return err
	}
	defer func() { f.Close(); os.Remove(f.Name()) }()
	if err = write(f); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
