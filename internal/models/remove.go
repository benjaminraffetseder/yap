package models

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// The managed models directory must resolve inside the actual app data folder.
// Refuse redirected directories and symlinks rather than deleting custom files.
func managedModelPath(dir, path string) error {
	root, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return err
	}
	modelDir, err := filepath.EvalSymlinks(filepath.Join(dir, "models"))
	if err != nil {
		return err
	}
	if !samePath(modelDir, filepath.Join(root, "models")) {
		return errors.New("model storage is redirected; remove the file manually")
	}
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return errors.New("only regular Yap-managed model files can be removed")
	}
	return nil
}

func samePath(a, b string) bool {
	a, _ = filepath.Abs(a)
	b, _ = filepath.Abs(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func Remove(dir, id, active string) error {
	known := false
	for _, model := range Catalog {
		if model.ID == id {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("unknown model %q", id)
	}
	path := filepath.Join(dir, "models", "ggml-"+id+".bin")
	if err := managedModelPath(dir, path); err != nil {
		return err
	}
	if samePath(path, active) {
		return errors.New("switch to another model before removing the active model")
	}
	selected, selectErr := os.Stat(active)
	target, targetErr := os.Stat(path)
	if selectErr == nil && targetErr == nil && os.SameFile(selected, target) {
		return errors.New("switch to another model before removing the active model")
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("could not remove model: %w", err)
	}
	return nil
}
