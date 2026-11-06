package models

import (
	"archive/zip"
	"context"
	"embed"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

//go:embed llama-LICENSE.txt gemma-LICENSE.txt
var textLicenses embed.FS

// TextCatalog pins both the conversion and the weights; model downloads never
// execute code from a model repository. Projectors are unnecessary for text.
type TextModel struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	MaxContext int    `json:"maxContext"`
	Installed  bool   `json:"installed"`
	DiskBytes  int64  `json:"diskBytes"`
	SHA        string `json:"-"`
	URL        string `json:"-"`
	Filename   string `json:"-"`
}

var TextCatalog = []TextModel{
	{ID: "gemma-4-e2b", Name: "Gemma 4 E2B", Size: 3349516256, MaxContext: 131072, Filename: "gemma-4-E2B_q4_0-it.gguf", SHA: "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634", URL: "https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/675cff42a74c774d6cb76f76d8eacb49b48c9b93/gemma-4-E2B_q4_0-it.gguf"},
	{ID: "gemma-4-e4b", Name: "Gemma 4 E4B", Size: 5154941280, MaxContext: 131072, Filename: "gemma-4-E4B_q4_0-it.gguf", SHA: "676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee", URL: "https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/4b4a2c1d584be7264f87aac328a1bc739ce81b6c/gemma-4-E4B_q4_0-it.gguf"},
	{ID: "gemma-4-12b", Name: "Gemma 4 12B", Size: 6975879296, MaxContext: 262144, Filename: "gemma-4-12b-it-qat-q4_0.gguf", SHA: "93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b", URL: "https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/resolve/29d097773436b69ff9feafd636ab4cf873786537/gemma-4-12b-it-qat-q4_0.gguf"},
}

func FindTextModel(id string) (TextModel, bool) {
	for _, m := range TextCatalog {
		if m.ID == id {
			return m, true
		}
	}
	return TextModel{}, false
}

func TextRuntimeAvailable() bool { return runtime.GOOS == "windows" && runtime.GOARCH == "amd64" }

func TextModelPath(dir, id string) (string, error) {
	m, ok := FindTextModel(id)
	if !ok {
		return "", errors.New("choose a built-in Gemma model")
	}
	root, err := managedModelDirectory(dir)
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, m.Filename)
	if err := managedModelPath(dir, path); err != nil {
		return "", errors.New("download this text model in Models first")
	}
	st, err := os.Stat(path)
	if err != nil || st.Size() != m.Size {
		return "", errors.New("text model is incomplete; download it again in Models")
	}
	return path, nil
}

func ListTextModels(dir string) []TextModel {
	list := append([]TextModel{}, TextCatalog...)
	for i := range list {
		_, err := TextModelPath(dir, list[i].ID)
		list[i].Installed = err == nil
		if root, err := managedModelDirectory(dir); err == nil {
			if st, e := os.Lstat(filepath.Join(root, list[i].Filename)); e == nil && st.Mode().IsRegular() {
				list[i].DiskBytes += st.Size()
			}
			parts := filepath.Join(root, ".text-download-"+list[i].ID)
			if actual, e := filepath.EvalSymlinks(parts); e == nil && samePath(actual, parts) {
				entries, _ := os.ReadDir(parts)
				for _, entry := range entries {
					if entry.Type().IsRegular() {
						if st, e := entry.Info(); e == nil {
							list[i].DiskBytes += st.Size()
						}
					}
				}
			}
		}
	}
	return list
}

func VerifiedTextModelPath(ctx context.Context, dir, id string) (string, error) {
	path, err := TextModelPath(dir, id)
	if err != nil {
		return "", err
	}
	m, _ := FindTextModel(id)
	valid, err := verifyModel(ctx, path, Model{Size: m.Size, SHA: m.SHA}, true)
	if err != nil {
		return "", err
	}
	if !valid {
		return "", errors.New("text model checksum mismatch; download it again in Models")
	}
	if _, err := managedRuntimeRoot(dir); err != nil {
		return "", err
	}
	return path, nil
}

func InstallTextModel(ctx context.Context, dir, id string, report func(int64, int64)) error {
	if !TextRuntimeAvailable() {
		return errors.New("built-in text models currently require Windows x64; use an external server on this platform")
	}
	m, ok := FindTextModel(id)
	if !ok {
		return errors.New("unknown text model")
	}
	return downloadTextModel(ctx, dir, m, report)
}

func RemoveTextModel(dir, id string) error {
	m, ok := FindTextModel(id)
	if !ok {
		return errors.New("unknown text model")
	}
	root, err := managedModelDirectory(dir)
	if err != nil {
		return err
	}
	path := filepath.Join(root, m.Filename)
	parts := filepath.Join(root, ".text-download-"+m.ID)
	if actual, err := filepath.EvalSymlinks(parts); err == nil {
		if !samePath(actual, parts) {
			return errors.New("text download storage is redirected; repair it manually")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if _, err := os.Lstat(path); err == nil {
		if err := managedModelPath(dir, path); err != nil {
			return err
		}
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("could not remove text model: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if actual, err := filepath.EvalSymlinks(parts); err == nil && samePath(actual, parts) {
		if err := os.RemoveAll(parts); err != nil {
			return err
		}
	}
	return nil
}

const textRuntimeVersion = "llama-b12110"

var textRuntimeAssets = map[string]runtimeAsset{
	"cpu":    {URL: "https://github.com/ggml-org/llama.cpp/releases/download/b12110/llama-b12110-bin-win-cpu-x64.zip", SHA: "98901e327c252875accaf2d1bf364e10e868843b0b63468baad1aa945cdc5da2", Size: 24708445},
	"vulkan": {URL: "https://github.com/ggml-org/llama.cpp/releases/download/b12110/llama-b12110-bin-win-vulkan-x64.zip", SHA: "9732a5e48887ca54d0bfe4af4324dc85fd56cd8cda19b52df3542fa6ebe6874f", Size: 37661146},
}

// App-local C++ runtime from Microsoft's signed Desktop framework package.
// UCRT is part of our supported Windows 10/11 OS baseline. No installer,
// elevation, registry changes, or system-wide C++ runtime is needed.
var textCRTAsset = runtimeAsset{URL: "https://download.microsoft.com/download/4/7/c/47c6134b-d61f-4024-83bd-b9c9ea951c25/Microsoft.VCLibs.x64.14.00.Desktop.appx", SHA: "b56a9101f706f9d95f815f5b7fa6efbac972e86573d378b96a07cff5540c5961", Size: 6764349}
var textCRTFiles = []string{"concrt140.dll", "msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "msvcp140_atomic_wait.dll", "msvcp140_codecvt_ids.dll", "vcruntime140.dll", "vcruntime140_1.dll"}

func textRuntimeHasCRT(path string) bool {
	for _, name := range textCRTFiles {
		st, err := os.Lstat(filepath.Join(filepath.Dir(path), name))
		if err != nil || !st.Mode().IsRegular() || st.Size() == 0 {
			return false
		}
	}
	return true
}

func installTextCRT(archive, dest string) error {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, name := range textCRTFiles {
		file, err := r.Open(name)
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(file, (8<<20)+1))
		file.Close()
		if err != nil {
			return err
		}
		if len(data) == 0 || len(data) > 8<<20 {
			return errors.New("invalid C++ runtime library")
		}
		if err := os.WriteFile(filepath.Join(dest, name), data, 0600); err != nil {
			return err
		}
	}
	return os.WriteFile(filepath.Join(dest, "Microsoft-VCLibs-source.txt"), []byte("Microsoft Visual C++ runtime libraries, copyright Microsoft Corporation.\nSource: "+textCRTAsset.URL+"\nSHA-256: "+textCRTAsset.SHA+"\nApp-local deployment: https://learn.microsoft.com/en-us/cpp/windows/choosing-a-deployment-method\n"), 0600)
}

func TextRuntimePath(dir, backend string) string {
	return filepath.Join(dir, "runtime", textRuntimeVersion+"-"+backend, "llama-server.exe")
}

func EnsureTextRuntime(ctx context.Context, dir string, report func(int64, int64)) error {
	if !TextRuntimeAvailable() {
		return errors.New("built-in text models currently require Windows x64")
	}
	root, err := managedRuntimeRoot(dir)
	if err != nil {
		return err
	}
	crtArchive := filepath.Join(root, "text-vclibs.appx")
	crtDownloaded := false
	defer func() {
		if crtDownloaded {
			_ = os.Remove(crtArchive)
		}
	}()
	for _, backend := range []string{"cpu", "vulkan"} {
		path := TextRuntimePath(dir, backend)
		if textRuntimeHasCRT(path) && checkNativeRuntime(ctx, path, "text") == nil {
			continue
		}
		asset := textRuntimeAssets[backend]
		archive := filepath.Join(root, textRuntimeVersion+"-"+backend+".zip")
		validate := func() error {
			actual, e := managedRuntimeRoot(dir)
			if e == nil && !samePath(actual, root) {
				e = errors.New("runtime storage changed during download")
			}
			return e
		}
		if !crtDownloaded {
			if err = download(ctx, textCRTAsset.URL, crtArchive, textCRTAsset.SHA, textCRTAsset.Size, report, validate); err != nil {
				return err
			}
			crtDownloaded = true
		}
		if err = download(ctx, asset.URL, archive, asset.SHA, asset.Size, report, validate); err != nil {
			return err
		}
		temp, e := os.MkdirTemp(root, ".extract-")
		if e != nil {
			return e
		}
		err = extractNativeArchive(ctx, archive, temp, false, false)
		if err == nil {
			err = installTextCRT(crtArchive, temp)
		}
		if err == nil {
			for _, name := range []string{"llama-LICENSE.txt", "gemma-LICENSE.txt"} {
				data, e := textLicenses.ReadFile(name)
				if e == nil {
					e = os.WriteFile(filepath.Join(temp, name), data, 0600)
				}
				if e != nil {
					err = e
					break
				}
			}
		}
		if err == nil {
			err = checkNativeRuntime(ctx, filepath.Join(temp, "llama-server.exe"), "text")
		}
		if err == nil {
			err = publishManagedRuntimeDirectory(ctx, dir, temp, textRuntimeVersion+"-"+backend, os.Rename)
		}
		os.RemoveAll(temp)
		os.Remove(archive)
		if err != nil {
			return err
		}
	}
	return nil
}
