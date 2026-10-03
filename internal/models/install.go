package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

type Model struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	Description string `json:"description"`
	SHA         string `json:"-"`
	Installed   bool   `json:"installed"`
	Path        string `json:"path"`
	DiskBytes   int64  `json:"diskBytes"`
	Removable   bool   `json:"removable"`
}

var Catalog = []Model{
	{ID: "tiny", Name: "Whisper Tiny", Size: 77691713, Description: "Fastest · short dictation", SHA: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"},
	{ID: "base", Name: "Whisper Base", Size: 147951465, Description: "Lightweight · everyday dictation", SHA: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"},
	{ID: "small", Name: "Whisper Small", Size: 487601967, Description: "Balanced · better accuracy", SHA: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"},
}

func List(dir string) []Model {
	list := append([]Model{}, Catalog...)
	for i := range list {
		p := filepath.Join(dir, "models", "ggml-"+list[i].ID+".bin")
		if st, err := os.Lstat(p); err == nil && st.Mode().IsRegular() {
			list[i].Path = p
			list[i].DiskBytes = st.Size()
			list[i].Removable = managedModelPath(dir, p) == nil
			if valid, err := verifyModel(context.Background(), p, list[i], true); err == nil && valid {
				list[i].Installed = true
				list[i].Path = p
			}
		}
	}
	return list
}

type progressWriter struct {
	ctx            context.Context
	total, current int64
	report         func(int64, int64)
	last           time.Time
}

func (w *progressWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	w.current += int64(len(p))
	if time.Since(w.last) > 150*time.Millisecond {
		w.report(w.current, w.total)
		w.last = time.Now()
	}
	return len(p), nil
}
func Download(ctx context.Context, url, dest, hash string, size int64, report func(int64, int64)) error {
	return download(ctx, url, dest, hash, size, report, nil)
}

func download(ctx context.Context, url, dest, hash string, size int64, report func(int64, int64), validate func() error) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Yap/0.1")
	resp, err := (&http.Client{Timeout: 30 * time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}
	if validate != nil {
		if err := validate(); err != nil {
			return err
		}
	}
	f, err := os.CreateTemp(filepath.Dir(dest), ".download-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	h := sha256.New()
	w := &progressWriter{ctx: ctx, total: size, report: report}
	n, copyErr := io.Copy(io.MultiWriter(f, h, w), io.LimitReader(resp.Body, size+1))
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n != size {
		return fmt.Errorf("download size mismatch: got %d, expected %d", n, size)
	}
	if hex.EncodeToString(h.Sum(nil)) != hash {
		return fmt.Errorf("download checksum mismatch")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if validate != nil {
		if err := validate(); err != nil {
			return err
		}
	}
	if err = os.Rename(f.Name(), dest); err != nil {
		return err
	}
	report(n, size)
	return nil
}
func Install(ctx context.Context, dir, id string, report func(int64, int64)) (string, error) {
	for _, m := range Catalog {
		if m.ID == id {
			return installModel(ctx, dir, m, "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-"+id+".bin", report)
		}
	}
	return "", fmt.Errorf("unknown model %q", id)
}
func installModel(ctx context.Context, dir string, model Model, url string, report func(int64, int64)) (string, error) {
	dest := filepath.Join(dir, "models", "ggml-"+model.ID+".bin")
	if err := ctx.Err(); err != nil {
		return dest, err
	}
	root, err := managedModelDirectory(dir)
	if err != nil {
		return dest, err
	}
	dest = filepath.Join(root, "ggml-"+model.ID+".bin")
	if _, err := os.Lstat(dest); err == nil {
		if err = managedModelPath(dir, dest); err != nil {
			return dest, err
		}
		valid, err := verifyModel(ctx, dest, model, false)
		if err != nil {
			return dest, err
		}
		if valid {
			return dest, nil
		}
	} else if !os.IsNotExist(err) {
		return dest, err
	}
	return dest, download(ctx, url, dest, model.SHA, model.Size, report, func() error {
		actual, err := managedModelDirectory(dir)
		if err != nil {
			return err
		}
		if !samePath(actual, root) {
			return errors.New("model storage changed during download; retry installation")
		}
		if _, err := os.Lstat(dest); os.IsNotExist(err) {
			return nil
		} else if err != nil {
			return err
		}
		return managedModelPath(dir, dest)
	})
}
func RuntimePath(dir string) string {
	return runtimePathIn(filepath.Join(dir, "runtime", "whisper-1.9.2"))
}

func runtimePathIn(root string) string {
	var found string
	filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err == nil && entry.Type().IsRegular() && entry.Name() == "whisper-cli.exe" {
			if info, err := entry.Info(); err == nil && info.Size() > 0 {
				found = path
			}
		}
		return nil
	})
	return found
}
func InstallRuntime(ctx context.Context, dir string, report func(int64, int64)) (string, error) {
	if runtime.GOOS == "darwin" {
		if path := PreferredRuntime(""); path != "" {
			return path, nil
		}
		return "", fmt.Errorf("this Mac build is missing its bundled Whisper runtime; select a local whisper-cli executable in Settings")
	}
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		return "", fmt.Errorf("select your platform's whisper-cli executable in Settings; automatic runtime installation supports Windows x64")
	}
	root, err := managedRuntimeRoot(dir)
	if err != nil {
		return "", err
	}
	if path := RuntimePath(dir); path != "" {
		return path, nil
	}
	archive := filepath.Join(root, "whisper.zip")
	validate := func() error {
		actual, err := managedRuntimeRoot(dir)
		if err != nil {
			return err
		}
		if !samePath(actual, root) {
			return errors.New("runtime storage changed during download; retry installation")
		}
		return nil
	}
	if err := download(ctx, "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip", archive, "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a", 8194445, report, validate); err != nil {
		return "", err
	}
	defer func() {
		if validate() == nil {
			_ = os.Remove(archive)
		}
	}()
	return installRuntimeArchive(ctx, dir, archive)
}
