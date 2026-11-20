package models

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// Only versions shipped by Yap may be removed. Never glob runtime storage or
// touch custom executables, model files, or another engine's installation.
var supersededNativeRuntimes = map[string][]string{
	"parakeet":  {"nemo-speech-0.2.0"},
	"moonshine": {"moonshine-0.1.5"},
	"whisper":   {"whisper-1.9.2"},
	"text":      {"llama-b12110-cpu", "llama-b12110-vulkan"},
	"ffmpeg":    {"ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-shared-9.0"},
}

// RuntimeUpdateAvailable reports known superseded Yap-managed installations.
// It never searches external paths or treats a missing runtime as an update.
func RuntimeUpdateAvailable(dir, kind string) bool {
	return nativeRuntimeUpdateAvailable(dir, kind)
}

// ReferencesSupersededRuntime includes custom aliases and directory junctions.
// Those selections cannot be left pointing into a directory about to be removed.
func ReferencesSupersededRuntime(dir, path, kind string) (bool, error) {
	executable, err := exec.LookPath(path)
	if errors.Is(err, exec.ErrNotFound) || os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	resolved, err := filepath.EvalSymlinks(executable)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	paths, err := supersededRuntimePaths(dir, kind)
	if err != nil {
		return false, err
	}
	for _, old := range paths {
		relative, err := filepath.Rel(old, resolved)
		if err == nil && filepath.IsLocal(relative) && relative != "." {
			return true, nil
		}
	}
	return false, nil
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
			return nil, errors.New("old runtime is redirected or invalid; repair it manually")
		}
		paths = append(paths, path)
	}
	return paths, nil
}

// UpdateModelRuntime installs and checks the replacement before deleting any
// superseded runtime. The model and the selected configuration are untouched.
func UpdateModelRuntime(ctx context.Context, dir, id string, report func(int64, int64)) error {
	return UpdateModelRuntimeWithSelection(ctx, dir, id, report, nil)
}

// UpdateModelRuntimeWithSelection lets the application persist a new managed
// Whisper executable before its old selected path is removed. A failed save
// leaves the old installation available for retry.
func UpdateModelRuntimeWithSelection(ctx context.Context, dir, id string, report func(int64, int64), selectRuntime func(string) error) error {
	for _, model := range Catalog {
		if model.ID != id {
			continue
		}
		kind := model.Kind
		if kind == "" {
			kind = "whisper"
		}
		if len(supersededNativeRuntimes[kind]) == 0 {
			return errors.New("no managed runtime update is available for this model")
		}
		// Validate old storage before downloading, then validate it again at cleanup.
		if _, err := supersededRuntimePaths(dir, kind); err != nil {
			return err
		}
		path, err := EnsureModelRuntime(ctx, dir, id, "", report)
		if err != nil {
			return err
		}
		if err := checkNativeRuntime(ctx, path, kind); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if kind == "whisper" && selectRuntime != nil {
			if err := selectRuntime(path); err != nil {
				return err
			}
		}
		return RemoveSupersededRuntimes(ctx, dir, kind)
	}
	return fmt.Errorf("unknown model %q", id)
}

// RemoveSupersededRuntimes removes only the known older directories of kind.
// Callers must first validate a replacement and switch any selected old path.
func RemoveSupersededRuntimes(ctx context.Context, dir, kind string) error {
	return removeSupersededNativeRuntimes(ctx, dir, kind)
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
			return fmt.Errorf("runtime updated; could not remove the old runtime; retry Update runtime: %w", err)
		}
	}
	return nil
}
