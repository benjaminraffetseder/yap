package models

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func installRuntimeArchive(ctx context.Context, dir, archive string, tgz bool) (string, error) {
	root, err := managedRuntimeRoot(dir)
	if err != nil {
		return "", err
	}
	temp, err := os.MkdirTemp(root, ".extract-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temp)
	if err = extractNativeArchive(ctx, archive, temp, tgz, tgz); err != nil {
		return "", err
	}
	// Validate the replacement while the previous installation is untouched.
	path := runtimePathIn(temp)
	if path == "" {
		return "", fmt.Errorf("Whisper executable missing from archive")
	}
	if tgz {
		if err = ValidateRuntime(ctx, path); err != nil {
			return "", err
		}
	}
	relative, err := filepath.Rel(temp, path)
	if err != nil {
		return "", err
	}
	if err = publishRuntimeDirectory(ctx, dir, temp, os.Rename); err != nil {
		return "", err
	}
	return filepath.Join(root, "whisper-1.9.2", relative), nil
}

// Never move or recursively remove an installation through redirected storage.
func managedRuntimeRoot(dir string) (string, error) {
	root, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", err
	}
	actual, err := filepath.EvalSymlinks(filepath.Join(dir, "runtime"))
	if err != nil {
		return "", err
	}
	if !samePath(actual, filepath.Join(root, "runtime")) {
		return "", errors.New("runtime storage is redirected; repair it manually")
	}
	return filepath.Abs(actual)
}

func publishRuntimeDirectory(ctx context.Context, dir, temp string, rename func(string, string) error) error {
	return publishManagedRuntimeDirectory(ctx, dir, temp, "whisper-1.9.2", rename)
}

func publishManagedRuntimeDirectory(ctx context.Context, dir, temp, name string, rename func(string, string) error) error {
	root, err := managedRuntimeRoot(dir)
	if err != nil {
		return err
	}
	actual, err := filepath.EvalSymlinks(temp)
	if err != nil {
		return err
	}
	if !samePath(filepath.Dir(temp), root) || !samePath(actual, temp) || !strings.HasPrefix(filepath.Base(temp), ".extract-") {
		return errors.New("invalid runtime staging directory")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	dest := filepath.Join(root, name)
	backup := ""
	if info, statErr := os.Lstat(dest); statErr == nil {
		actual, err := filepath.EvalSymlinks(dest)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !samePath(actual, dest) {
			return errors.New("managed runtime is redirected or invalid; repair it manually")
		}
		backup, err = os.MkdirTemp(root, ".replaced-")
		if err != nil {
			return err
		}
		if err = os.Remove(backup); err != nil {
			return err
		}
		if err = rename(dest, backup); err != nil {
			return fmt.Errorf("stage incomplete runtime: %w", err)
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	// Keep the previous directory until publication succeeds. A failed swap or
	// cancellation restores it; only a successful replacement discards it.
	err = ctx.Err()
	if err == nil {
		err = rename(temp, dest)
	}
	if err != nil {
		if backup != "" {
			if restoreErr := rename(backup, dest); restoreErr != nil {
				return errors.Join(err, fmt.Errorf("restore previous runtime from %s: %w", backup, restoreErr))
			}
		}
		return err
	}
	if backup != "" {
		if err = os.RemoveAll(backup); err != nil {
			return fmt.Errorf("runtime installed; could not remove previous runtime: %w", err)
		}
	}
	return nil
}
