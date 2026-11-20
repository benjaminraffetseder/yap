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
	"parakeet/linux/amd64":    {"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.3.0/nemo-speech-0.3.0-linux-x86_64-cpu.tar.gz", "255f12b722ab15b2a38a51cf125d56e3fa97058b528f7e895b39d6a473deb06e", 9605101, true},
	"parakeet/linux/arm64":    {"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.3.0/nemo-speech-0.3.0-linux-aarch64-cpu.tar.gz", "56858eaf50d19b05902c043f65d0057352bdc107ae380c41053bfbddfc204bf1", 9064856, true},
	"parakeet/windows/amd64":  {"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.3.0/nemo-speech-0.3.0-windows-x86_64-cpu.zip", "4ed9740e361e4653f56c3dce7d1e81883a1c8b831c1bd7d01567fff1130b5b05", 8694509, false},
	"parakeet/darwin/arm64":   {"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.3.0/nemo-speech-0.3.0-macos-aarch64-metal.tar.gz", "2b972ed8b5dba07492212acf8cb75cbf34ecb141198ffa1997febe84b7c4d9ed", 7239335, true},
	"parakeet/darwin/amd64":   {"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.3.0/nemo-speech-0.3.0-macos-x86_64-cpu.tar.gz", "97e98aa5eb82dffa4f513f26336b5301d792c9fb43f720ac8f9520a0e92ffe3f", 7742012, true},
	"moonshine/windows/amd64": {"https://files.pythonhosted.org/packages/7f/07/aafde753e2819bc5dca333b45a90f3dad475a41da2c97ddd60ccc6e37479/moonshine_voice-0.1.6-py3-none-win_amd64.whl", "29a54f9249d41735db62b1f97272905cf114554f293c166f0f4f81655a4a2cfc", 16616460, false},
	"moonshine/darwin/arm64":  {"https://files.pythonhosted.org/packages/25/ad/91ef5908f592faff47dd4e03073b3eb073ce88f984f6bc86031e02057a69/moonshine_voice-0.1.6-py3-none-macosx_15_0_arm64.whl", "71f0fa9d0b01fa317f86a85e846e9faa247be985f92b50970817dd999e400ff4", 18670056, false},
	"moonshine/linux/amd64":   {"https://files.pythonhosted.org/packages/54/47/20993e0676642cf05273b6b2fed13076a5b4028156c938dd86136bb71797/moonshine_voice-0.1.6-py3-none-manylinux_2_34_x86_64.whl", "04e438f393af3f963ac7988204f379d04a9c8949801595cab4bd68a7ceedf6c7", 20020861, false},
	"moonshine/linux/arm64":   {"https://files.pythonhosted.org/packages/3f/ad/f6cad5893e822303fed6c0931127274e7bfc19ebdad5aaa7af87888d242b/moonshine_voice-0.1.6-py3-none-manylinux_2_31_aarch64.whl", "16589b0e86e4a66fbbb7bb1429deaa56a47f33fdc1cd0aef4b781ccbf49c95df", 18607530, false},
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
		return "", fmt.Errorf("%s runtime is not available for %s %s", m.Name, runtime.GOOS, runtime.GOARCH)
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
	name := "moonshine-" + speech.MoonshineRuntimeVersion
	if m.Kind == "parakeet" {
		name = "nemo-speech-" + speech.ParakeetRuntimeVersion
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
	// Unix archives use versioned library links. Materialize only links to
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
