package models

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"yap/internal/inference/speech"
	"yap/internal/process"
)

type runtimeAsset struct {
	URL, SHA string
	Size     int64
	Tar      bool
}

var nativeRuntimes = map[string]runtimeAsset{
	"parakeet/windows/amd64":  {"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0/nemo-speech-0.2.0-windows-x86_64-cpu.zip", "82c80451086e86194aba9af19f800da77cd66d1c28d993d0efceffd6cdb49bb8", 5528418, false},
	"parakeet/darwin/arm64":   {"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0/nemo-speech-0.2.0-macos-aarch64-metal.tar.gz", "5cb02ba7c04f0b5585ce5cde9c830be5f0b7dfb4c83083c500109c381b4f2da9", 5031510, true},
	"parakeet/darwin/amd64":   {"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0/nemo-speech-0.2.0-macos-x86_64-cpu.tar.gz", "d52c318d8197511d4f7eee02bcf05511f7e91b300555a130b562e571695a0f39", 5256846, true},
	"moonshine/windows/amd64": {"https://files.pythonhosted.org/packages/ea/05/ad3457baa56170a13829c98327598a4d99d6cd4bdff8ae59df4c47ebdd11/moonshine_voice-0.1.5-py3-none-win_amd64.whl", "7fc9a84e827360ddb85c2735f44a1502c5575c27dcb476a2555646cd20a70e9d", 16542073, false},
	"moonshine/darwin/arm64":  {"https://files.pythonhosted.org/packages/86/2a/9eca2f000e4990315d18aa360c6eb679417b29252e6307c273bcbef38461/moonshine_voice-0.1.5-py3-none-macosx_15_0_arm64.whl", "9866b1956d12fff11923ad42f1140bcb314bf05bf8d8576fb7b3aa819ec40e51", 18589534, false},
}

func EnsureModelRuntime(ctx context.Context, dir, id, whisper string, report func(int64, int64)) (string, error) {
	var m Model
	found := false
	for _, candidate := range Catalog {
		if candidate.ID == id {
			m, found = candidate, true
			break
		}
	}
	if !found {
		return "", fmt.Errorf("unknown model %q", id)
	}
	if m.Kind == "" {
		return EnsureRuntime(ctx, dir, whisper, report)
	}
	asset, ok := nativeRuntimes[m.Kind+"/"+runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		return "", fmt.Errorf("%s runtime is not available for %s %s; Moonshine requires Windows x64 or Apple Silicon with macOS 15 or newer", m.Name, runtime.GOOS, runtime.GOARCH)
	}
	root, err := managedRuntimeRoot(dir)
	if err != nil {
		return "", err
	}
	path := speech.RuntimePath(dir, m.Kind)
	if checkNativeRuntime(ctx, path, m.Kind) == nil {
		return path, nil
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	archive := filepath.Join(root, m.Kind+".archive")
	validate := func() error {
		actual, err := managedRuntimeRoot(dir)
		if err != nil {
			return err
		}
		if !samePath(actual, root) {
			return errors.New("runtime storage changed during download")
		}
		return nil
	}
	if err = download(ctx, asset.URL, archive, asset.SHA, asset.Size, report, validate); err != nil {
		return "", err
	}
	defer func() {
		if validate() == nil {
			_ = os.Remove(archive)
		}
	}()
	temp, err := os.MkdirTemp(root, ".extract-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temp)
	if err = extractNativeArchive(ctx, archive, temp, asset.Tar, m.Kind == "parakeet"); err != nil {
		return "", err
	}
	name := "moonshine-0.1.5"
	if m.Kind == "parakeet" {
		name = "nemo-speech-0.2.0"
	}
	rel, _ := filepath.Rel(filepath.Join(root, name), path)
	if err = checkNativeRuntime(ctx, filepath.Join(temp, rel), m.Kind); err != nil {
		return "", err
	}
	if err = publishManagedRuntimeDirectory(ctx, dir, temp, name, os.Rename); err != nil {
		return "", err
	}
	return path, nil
}

func checkNativeRuntime(ctx context.Context, path, kind string) error {
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || st.Size() == 0 {
		return errors.New("invalid speech runtime")
	}
	executable, args := path, []string{"--help"}
	if kind == "moonshine" {
		executable, err = os.Executable()
		if err != nil {
			return err
		}
		args = []string{"--yap-moonshine-check", path}
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, args...)
	process.Hide(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s runtime cannot start; reinstall it in Models: %w\n%s", kind, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func extractNativeArchive(ctx context.Context, archive, root string, tgz, stripTop bool) error {
	var total int64
	write := func(name string, size int64, executable bool, src io.Reader) error {
		name = strings.ReplaceAll(name, "\\", "/")
		if !filepath.IsLocal(filepath.FromSlash(name)) || strings.Contains(name, ":") {
			return errors.New("invalid runtime archive path")
		}
		if stripTop {
			_, name, _ = strings.Cut(name, "/")
		}
		if name == "" {
			return nil
		}
		if size < 0 || size > 512<<20 || total+size > 1<<30 {
			return errors.New("runtime archive is too large")
		}
		total += size
		if err := ctx.Err(); err != nil {
			return err
		}
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		mode := os.FileMode(0600)
		if executable {
			mode = 0700
		}
		out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
		if err != nil {
			return err
		}
		n, copyErr := io.Copy(out, io.LimitReader(src, size+1))
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if n != size {
			return errors.New("truncated runtime archive")
		}
		return ctx.Err()
	}
	if !tgz {
		r, err := zip.OpenReader(archive)
		if err != nil {
			return err
		}
		defer r.Close()
		for _, f := range r.File {
			if f.FileInfo().IsDir() {
				continue
			}
			if !f.Mode().IsRegular() {
				return errors.New("invalid runtime archive entry")
			}
			src, err := f.Open()
			if err != nil {
				return err
			}
			err = write(f.Name, int64(f.UncompressedSize64), f.Mode()&0111 != 0, src)
			src.Close()
			if err != nil {
				return err
			}
		}
		return nil
	}
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	r := tar.NewReader(gz)
	links := map[string]string{}
	for {
		h, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if h.Typeflag == tar.TypeDir {
			continue
		}
		if h.Typeflag == tar.TypeSymlink {
			name := filepath.FromSlash(h.Name)
			if !filepath.IsLocal(name) || strings.Contains(name, ":") || !filepath.IsLocal(filepath.FromSlash(h.Linkname)) {
				return errors.New("invalid runtime library link")
			}
			if stripTop {
				_, rest, _ := strings.Cut(h.Name, "/")
				name = filepath.FromSlash(rest)
			}
			links[name] = filepath.Join(filepath.Dir(name), filepath.FromSlash(h.Linkname))
			continue
		}
		if h.Typeflag != tar.TypeReg {
			return errors.New("invalid runtime archive entry")
		}
		if err = write(h.Name, h.Size, h.Mode&0111 != 0, r); err != nil {
			return err
		}
	}
	// macOS archives use versioned library links. Materialize only links to
	// regular files inside this staging tree, keeping managed storage link-free.
	for name, target := range links {
		seen := map[string]bool{name: true}
		for links[target] != "" {
			if seen[target] {
				return errors.New("cyclic runtime library link")
			}
			seen[target] = true
			target = links[target]
		}
		if !filepath.IsLocal(name) || !filepath.IsLocal(target) {
			return errors.New("invalid runtime library link")
		}
		st, err := os.Lstat(filepath.Join(root, target))
		if err != nil || !st.Mode().IsRegular() {
			return errors.New("missing runtime library link target")
		}
		src, err := os.Open(filepath.Join(root, target))
		if err != nil {
			return err
		}
		archiveName := filepath.ToSlash(name)
		if stripTop {
			archiveName = "archive/" + archiveName
		}
		err = write(archiveName, st.Size(), st.Mode()&0111 != 0, src)
		src.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
