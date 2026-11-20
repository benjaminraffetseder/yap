package models

import (
	"archive/zip"
	"context"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"yap/internal/process"
)

// Pin the monthly retained release, never the moving "latest" release.
const FFmpegPackage = "ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-shared-9.0"
const FFmpegSize int64 = 76576818
const FFmpegSHA256 = "e907b01fa4783913151237e37df2a10fa97d99a1598a021bf59d4ae62ffed4c0"
const FFmpegURL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/" + FFmpegPackage + ".zip"

//go:embed ffmpeg-notice.txt
var ffmpegNotice []byte

// LGPLv3 incorporates GPLv3; retain both alongside upstream's LICENSE.txt.
//
//go:embed ffmpeg-GPLv3.txt
var ffmpegGPL []byte

func CanInstallFFmpeg() bool { return runtime.GOOS == "windows" && runtime.GOARCH == "amd64" }

var ffmpegRequired = []string{
	"bin/ffmpeg.exe", "bin/avcodec-63.dll", "bin/avdevice-63.dll",
	"bin/avfilter-12.dll", "bin/avformat-63.dll", "bin/avutil-61.dll",
	"bin/swresample-7.dll", "bin/swscale-10.dll", "LICENSE.txt",
	"COPYING.GPLv3", "YAP-SOURCE-NOTICE.txt",
}

func ffmpegPathIn(dir string) string {
	for _, name := range ffmpegRequired {
		path := filepath.Join(dir, filepath.FromSlash(name))
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return ""
		}
		actual, err := filepath.EvalSymlinks(path)
		if err != nil || !samePath(actual, path) {
			return ""
		}
	}
	return filepath.Join(dir, "bin", "ffmpeg.exe")
}

func FFmpegPath(dir string) string {
	if path := currentFFmpegPath(dir); path != "" {
		return path
	}
	return PreviousFFmpegPath(dir)
}

func currentFFmpegPath(dir string) string {
	if !CanInstallFFmpeg() {
		return ""
	}
	root, err := managedRuntimeRoot(dir)
	if err != nil {
		return ""
	}
	return ffmpegPathIn(filepath.Join(root, FFmpegPackage))
}

func InstallFFmpeg(ctx context.Context, dir string, report func(int64, int64)) (string, error) {
	if !CanInstallFFmpeg() {
		return "", errors.New("automatic audio support installation requires Windows x64")
	}
	return installFFmpegWithProbe(ctx, dir, FFmpegURL, FFmpegSHA256, FFmpegSize, report, validateFFmpegRuntime)
}

func installFFmpeg(ctx context.Context, dir, url, hash string, size int64, report func(int64, int64)) (string, error) {
	return installFFmpegWithProbe(ctx, dir, url, hash, size, report, nil)
}

func installFFmpegWithProbe(ctx context.Context, dir, url, hash string, size int64, report func(int64, int64), probe func(context.Context, string) error) (string, error) {
	root, err := managedRuntimeRoot(dir)
	if err != nil {
		return "", err
	}
	// Unique staging prevents partial downloads or extraction becoming discoverable.
	stage, err := os.MkdirTemp(root, ".extract-ffmpeg-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	validate := func() error {
		actual, err := managedRuntimeRoot(dir)
		if err != nil {
			return err
		}
		resolved, err := filepath.EvalSymlinks(stage)
		if err != nil {
			return err
		}
		if !samePath(actual, root) || !samePath(resolved, stage) {
			return errors.New("audio support storage changed; retry installation")
		}
		return nil
	}
	archive := filepath.Join(stage, "download.zip")
	if err = download(ctx, url, archive, hash, size, report, validate); err != nil {
		return "", err
	}
	if err = extractFFmpeg(ctx, archive, stage); err != nil {
		return "", err
	}
	if err = os.Remove(archive); err != nil {
		return "", err
	}
	if err = os.WriteFile(filepath.Join(stage, "YAP-SOURCE-NOTICE.txt"), ffmpegNotice, 0600); err != nil {
		return "", err
	}
	if err = os.WriteFile(filepath.Join(stage, "COPYING.GPLv3"), ffmpegGPL, 0600); err != nil {
		return "", err
	}
	if ffmpegPathIn(stage) == "" {
		return "", errors.New("audio support archive is missing required files")
	}
	if probe != nil {
		if err := probe(ctx, ffmpegPathIn(stage)); err != nil {
			return "", err
		}
	}
	if err = validate(); err != nil {
		return "", err
	}
	if err = publishManagedRuntimeDirectory(ctx, dir, stage, FFmpegPackage, os.Rename); err != nil {
		return "", err
	}
	return filepath.Join(root, FFmpegPackage, "bin", "ffmpeg.exe"), nil
}

func validateFFmpegRuntime(ctx context.Context, path string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "-version")
	process.Hide(cmd)
	cmd.WaitDelay = time.Second
	if log, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("audio support cannot start; the previous runtime was kept: %w\n%s", err, strings.TrimSpace(string(log)))
	}
	return nil
}

// PreviousFFmpegPath keeps an existing managed decoder usable until the user
// upgrades it. Custom and system installations are not rewritten or removed.
func PreviousFFmpegPath(dir string) string {
	if !CanInstallFFmpeg() {
		return ""
	}
	paths, err := supersededRuntimePaths(dir, "ffmpeg")
	if err != nil {
		return ""
	}
	for _, path := range paths {
		if executable := ffmpegPathIn(path); executable != "" {
			return executable
		}
	}
	return ""
}

func UpdateFFmpegRuntime(ctx context.Context, dir string, report func(int64, int64)) (string, error) {
	if _, err := supersededRuntimePaths(dir, "ffmpeg"); err != nil {
		return "", err
	}
	path := currentFFmpegPath(dir)
	if path == "" || validateFFmpegRuntime(ctx, path) != nil {
		var err error
		path, err = InstallFFmpeg(ctx, dir, report)
		if err != nil {
			return "", err
		}
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := RemoveSupersededRuntimes(ctx, dir, "ffmpeg"); err != nil {
		return path, err
	}
	return path, nil
}

func extractFFmpeg(ctx context.Context, archive, stage string) error {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer r.Close()
	if len(r.File) > 2000 {
		return errors.New("audio support archive has too many files")
	}
	var total uint64
	for _, file := range r.File {
		if err = ctx.Err(); err != nil {
			return err
		}
		if !strings.HasPrefix(file.Name, FFmpegPackage+"/") {
			return errors.New("invalid audio support archive root")
		}
		name := strings.TrimPrefix(file.Name, FFmpegPackage+"/")
		if name == "" && file.FileInfo().IsDir() {
			continue
		}
		if !filepath.IsLocal(filepath.FromSlash(name)) || strings.ContainsAny(name, ":\\") || file.Mode()&os.ModeSymlink != 0 {
			return errors.New("invalid audio support archive path")
		}
		total += file.UncompressedSize64
		if file.UncompressedSize64 > 512<<20 || total > 512<<20 {
			return errors.New("audio support archive is too large")
		}
		dest := filepath.Join(stage, filepath.FromSlash(name))
		if file.FileInfo().IsDir() {
			if err = os.MkdirAll(dest, 0700); err != nil {
				return err
			}
			continue
		}
		if !file.Mode().IsRegular() {
			return errors.New("invalid audio support archive entry")
		}
		if err = os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		src, err := file.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			src.Close()
			return err
		}
		n, copyErr := io.Copy(out, io.LimitReader(ffmpegReader{ctx, src}, int64(file.UncompressedSize64)+1))
		err = errors.Join(copyErr, src.Close(), out.Close())
		if err != nil {
			return err
		}
		if n != int64(file.UncompressedSize64) {
			return fmt.Errorf("invalid extracted size for %s", name)
		}
	}
	return ctx.Err()
}

type ffmpegReader struct {
	ctx context.Context
	io.Reader
}

func (r ffmpegReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(p)
}
