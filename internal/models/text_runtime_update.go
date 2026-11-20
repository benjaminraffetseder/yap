package models

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
)

// UpdateTextRuntime leaves the previous CPU and Vulkan installations in place
// until every backend being replaced has a usable current installation.
func UpdateTextRuntime(ctx context.Context, dir string, report func(int64, int64)) error {
	previous, err := supersededRuntimePaths(dir, "text")
	if err != nil {
		return err
	}
	if err := EnsureTextRuntime(ctx, dir, report); err != nil {
		return err
	}
	if err := checkNativeRuntime(ctx, TextRuntimePath(dir, "cpu"), "text"); err != nil {
		return err
	}
	for _, path := range previous {
		if strings.HasSuffix(filepath.Base(path), "-vulkan") {
			if err := checkNativeRuntime(ctx, TextRuntimePath(dir, "vulkan"), "text"); err != nil {
				return fmt.Errorf("text runtime update is incomplete; previous runtimes were kept: %w", err)
			}
		}
	}
	return RemoveSupersededRuntimes(ctx, dir, "text")
}
