package models

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Only versions shipped by Yap may be removed. Never glob runtime storage or
// touch custom executables, model files, or another engine's installation.
var supersededNativeRuntimes = map[string][]string{
	"parakeet": {"nemo-speech-0.2.0"},
}

func nativeRuntimeUpdateAvailable(dir, kind string) bool {
	paths, err := supersededRuntimePaths(dir, kind)
	return err == nil && len(paths) > 0
}

func supersededRuntimePaths(dir, kind string) ([]string, error) {
	names := supersededNativeRuntimes[kind]
	if len(names) == 0 {
		return nil, nil
	}
	root, err := managedRuntimeRoot(dir)
	if err != nil {
		return nil, err
	}
	var paths []string
	for _, name := range names {
		path := filepath.Join(root, name)
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		actual, err := filepath.EvalSymlinks(path)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !samePath(actual, path) || !samePath(filepath.Dir(actual), root) {
			return nil, errors.New("old speech runtime is redirected or invalid; repair it manually")
		}
		paths = append(paths, path)
	}
	return paths, nil
}

// UpdateModelRuntime installs and checks the replacement before deleting any
// superseded runtime. The model and the selected configuration are untouched.
func UpdateModelRuntime(ctx context.Context, dir, id string, report func(int64, int64)) error {
	for _, model := range Catalog {
		if model.ID != id {
			continue
		}
		if len(supersededNativeRuntimes[model.Kind]) == 0 {
			return errors.New("no managed runtime update is available for this model")
		}
		// Validate old storage before downloading, then validate it again at cleanup.
		if _, err := supersededRuntimePaths(dir, model.Kind); err != nil {
			return err
		}
		path, err := EnsureModelRuntime(ctx, dir, id, "", report)
		if err != nil {
			return err
		}
		if err := checkNativeRuntime(ctx, path, model.Kind); err != nil {
			return err
		}
		return removeSupersededNativeRuntimes(ctx, dir, model.Kind)
	}
	return fmt.Errorf("unknown model %q", id)
}

func removeSupersededNativeRuntimes(ctx context.Context, dir, kind string) error {
	paths, err := supersededRuntimePaths(dir, kind)
	if err != nil {
		return err
	}
	for _, path := range paths {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("speech runtime updated; could not remove the old runtime; retry Update runtime: %w", err)
		}
	}
	return nil
}
