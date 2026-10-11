package models

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"yap/internal/inference/speech"
)

func modelPath(dir string, m Model) string {
	name := "ggml-" + m.ID + ".bin"
	if m.Filename != "" {
		name = m.Filename
	}
	if len(m.Files) > 0 {
		name = m.ID
	}
	return filepath.Join(dir, "models", name)
}

func safeBundle(dir, path string) error {
	root, err := managedModelDirectory(dir)
	if err != nil {
		return err
	}
	if !samePath(filepath.Dir(path), root) {
		return errors.New("model folder is outside managed storage")
	}
	return filepath.WalkDir(path, func(p string, e os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if e.Type()&os.ModeSymlink != 0 || (!e.IsDir() && !e.Type().IsRegular()) {
			return errors.New("model folder contains redirected or invalid files; repair it manually")
		}
		return nil
	})
}

func verifyBundle(ctx context.Context, path string, m Model, cached bool) bool {
	b, err := speech.ReadBundle(path)
	if err != nil || b.Arch != m.Arch || len(b.Files) != len(m.Files) {
		return false
	}
	for i, f := range m.Files {
		if b.Files[i].Name != f.Name || b.Files[i].Size != f.Size {
			return false
		}
		valid, err := verifyModel(ctx, filepath.Join(path, f.Name), Model{Size: f.Size, SHA: f.SHA}, cached)
		if err != nil || !valid {
			return false
		}
	}
	return true
}

func listBundle(dir string, m Model, path string) Model {
	if _, err := os.Lstat(path); err != nil {
		return m
	}
	m.Path = path
	m.Removable = safeBundle(dir, path) == nil
	if !m.Removable {
		return m
	}
	_ = filepath.WalkDir(path, func(p string, e os.DirEntry, err error) error {
		if err == nil && e.Type().IsRegular() {
			if st, err := e.Info(); err == nil {
				m.DiskBytes += st.Size()
			}
		}
		return nil
	})
	m.Installed = verifyBundle(context.Background(), path, m, true)
	return m
}

func installBundle(ctx context.Context, dir string, m Model, report func(int64, int64)) (string, error) {
	dest := modelPath(dir, m)
	if err := ctx.Err(); err != nil {
		return dest, err
	}
	root, err := managedModelDirectory(dir)
	if err != nil {
		return dest, err
	}
	validate := func() error {
		actual, err := managedModelDirectory(dir)
		if err != nil {
			return err
		}
		if !samePath(actual, root) {
			return errors.New("model storage changed during download")
		}
		if _, err := os.Lstat(dest); os.IsNotExist(err) {
			return nil
		} else if err != nil {
			return err
		}
		return safeBundle(dir, dest)
	}
	if err = validate(); err != nil {
		return dest, err
	}
	if verifyBundle(ctx, dest, m, false) {
		return dest, nil
	}
	temp, err := os.MkdirTemp(root, ".download-model-")
	if err != nil {
		return dest, err
	}
	defer os.RemoveAll(temp)
	var done int64
	b := speech.Bundle{Arch: m.Arch}
	for _, f := range m.Files {
		if filepath.Base(f.Name) != f.Name || f.Name == "." {
			return dest, errors.New("invalid model asset name")
		}
		err = download(ctx, f.URL, filepath.Join(temp, f.Name), f.SHA, f.Size, func(n, _ int64) { report(done+n, m.Size) }, validate)
		if err != nil {
			return dest, err
		}
		done += f.Size
		b.Files = append(b.Files, speech.BundleFile{Name: f.Name, Size: f.Size})
	}
	data, err := json.Marshal(b)
	if err != nil {
		return dest, err
	}
	if err = os.WriteFile(filepath.Join(temp, speech.BundleManifest), data, 0600); err != nil {
		return dest, err
	}
	if err = ctx.Err(); err != nil {
		return dest, err
	}
	if err = validate(); err != nil {
		return dest, err
	}
	backup := ""
	if _, err := os.Lstat(dest); err == nil {
		backup, err = os.MkdirTemp(root, ".replaced-model-")
		if err != nil {
			return dest, err
		}
		if err = os.Remove(backup); err != nil {
			return dest, err
		}
		if err = os.Rename(dest, backup); err != nil {
			return dest, err
		}
	}
	if err = os.Rename(temp, dest); err != nil {
		if backup != "" {
			if restore := os.Rename(backup, dest); restore != nil {
				return dest, errors.Join(err, fmt.Errorf("restore model from %s: %w", backup, restore))
			}
		}
		return dest, err
	}
	if backup != "" {
		_ = os.RemoveAll(backup)
	}
	report(m.Size, m.Size)
	return dest, nil
}
