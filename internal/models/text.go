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
	ID                     string `json:"id"`
	Name                   string `json:"name"`
	Size                   int64  `json:"size"`
	MaxContext             int    `json:"maxContext"`
	Installed              bool   `json:"installed"`
	DiskBytes              int64  `json:"diskBytes"`
	RuntimeUpdateAvailable bool   `json:"runtimeUpdateAvailable"`
	SHA                    string `json:"-"`
	URL                    string `json:"-"`
	Filename               string `json:"-"`
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

func TextRuntimeAvailable() bool {
	_, ok := textRuntimeAssets[runtime.GOOS+"/"+runtime.GOARCH+"/cpu"]
	return ok
}

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
		list[i].RuntimeUpdateAvailable = list[i].Installed && RuntimeUpdateAvailable(dir, "text")
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
		return errors.New("built-in text models require Windows x64 or Linux x64/arm64; use an external server on this platform")
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

// Binary build b12359 is the exact commit tagged as llama.cpp v1.0.0.
const textRuntimeVersion = "llama-b12359"

var textRuntimeAssets = map[string]runtimeAsset{
	"windows/amd64/cpu":    {URL: "https://github.com/ggml-org/llama.cpp/releases/download/b12359/llama-b12359-bin-win-cpu-x64.zip", SHA: "837c1655e87df3b66989f4be33a792a1399c785bf259038dc75c900096683e69", Size: 25097509},
	"windows/amd64/vulkan": {URL: "https://github.com/ggml-org/llama.cpp/releases/download/b12359/llama-b12359-bin-win-vulkan-x64.zip", SHA: "e8d18c6e4210cca87e7307c2ea78363ac8d158e4e1397358ec96ab70b53a0d5e", Size: 38090643},
	"linux/amd64/cpu":      {URL: "https://github.com/ggml-org/llama.cpp/releases/download/b12359/llama-b12359-bin-ubuntu-x64.tar.gz", SHA: "0bc1f091e8916102b6d8f2cf944233a620e90a0f856c72d0ce41150c65c2e72e", Size: 23311084, Tar: true},
	"linux/amd64/vulkan":   {URL: "https://github.com/ggml-org/llama.cpp/releases/download/b12359/llama-b12359-bin-ubuntu-vulkan-x64.tar.gz", SHA: "19b60f00395a3f4954e46a5037695bc1d843404fc9d3124f82a612ecd8fbe9f0", Size: 36153377, Tar: true},
	"linux/arm64/cpu":      {URL: "https://github.com/ggml-org/llama.cpp/releases/download/b12359/llama-b12359-bin-ubuntu-arm64.tar.gz", SHA: "dc7aa17a67884619b7223870aca9fd6addbc01717713b04a714add1c31137359", Size: 18949862, Tar: true},
	"linux/arm64/vulkan":   {URL: "https://github.com/ggml-org/llama.cpp/releases/download/b12359/llama-b12359-bin-ubuntu-vulkan-arm64.tar.gz", SHA: "3f8ae812a58ac92e5a596ca9fbc988f52854d147c5a7fe1264dddc90c1d085b4", Size: 29435221, Tar: true},
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
	name := "llama-server"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(dir, "runtime", textRuntimeVersion+"-"+backend, name)
}

func EnsureTextRuntime(ctx context.Context, dir string, report func(int64, int64)) error {
	if !TextRuntimeAvailable() {
		return errors.New("built-in text models require Windows x64 or Linux x64/arm64")
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
	installBackend := func(backend string) error {
		path := TextRuntimePath(dir, backend)
		if (runtime.GOOS != "windows" || textRuntimeHasCRT(path)) && checkNativeRuntime(ctx, path, "text") == nil {
			return nil
		}
		asset := textRuntimeAssets[runtime.GOOS+"/"+runtime.GOARCH+"/"+backend]
		ext := ".zip"
		if asset.Tar {
			ext = ".tar.gz"
		}
		archive := filepath.Join(root, textRuntimeVersion+"-"+backend+ext)
		validate := func() error {
			actual, e := managedRuntimeRoot(dir)
			if e == nil && !samePath(actual, root) {
				e = errors.New("runtime storage changed during download")
			}
			return e
		}
		if runtime.GOOS == "windows" && !crtDownloaded {
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
		err = extractNativeArchive(ctx, archive, temp, asset.Tar, asset.Tar)
		if err == nil && runtime.GOOS == "windows" {
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
			err = checkNativeRuntime(ctx, filepath.Join(temp, filepath.Base(path)), "text")
		}
		if err == nil {
			err = publishManagedRuntimeDirectory(ctx, dir, temp, textRuntimeVersion+"-"+backend, os.Rename)
		}
		os.RemoveAll(temp)
		os.Remove(archive)
		return err
	}
	if err := installBackend("cpu"); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// A usable CPU runtime is required; GPU acceleration is best effort. Keep
	// failed Vulkan replacements unpublished and let inference fall back to CPU.
	_ = installBackend("vulkan")
	return ctx.Err()
}
