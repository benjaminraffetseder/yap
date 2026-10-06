package models

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"yap/internal/inference/speech"
	"yap/internal/process"
)

// A bounded help invocation checks the binary and its loader dependencies.
func ValidateRuntime(ctx context.Context, path string) error {
	if err := speech.ValidateExecutable(path); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--help")
	process.Hide(cmd)
	cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
	cmd.WaitDelay = time.Second
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Whisper runtime cannot start; check its required libraries or repair the managed runtime: %w", err)
	}
	return nil
}

func IsManagedRuntime(dir, path string) bool {
	if path == "" {
		return false
	}
	root, _ := filepath.Abs(filepath.Join(dir, "runtime", "whisper-1.9.2"))
	path, _ = filepath.Abs(path)
	rel, err := filepath.Rel(root, path)
	return err == nil && filepath.IsLocal(rel) && rel != "." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// Managed paths are repaired in place; custom selections are never replaced.
func EnsureRuntime(ctx context.Context, dir, selected string, report func(int64, int64)) (string, error) {
	path := selected
	var err error
	if path == "" || IsManagedRuntime(dir, path) {
		path, err = InstallRuntime(ctx, dir, report)
	}
	if err == nil {
		err = ValidateRuntime(ctx, path)
	}
	return path, err
}
