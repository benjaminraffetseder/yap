package models

import (
	"context"
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
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Size        int64       `json:"size"`
	Description string      `json:"description"`
	SHA         string      `json:"-"`
	Installed   bool        `json:"installed"`
	Path        string      `json:"path"`
	DiskBytes   int64       `json:"diskBytes"`
	Removable   bool        `json:"removable"`
	Kind        string      `json:"-"`
	Filename    string      `json:"-"`
	URL         string      `json:"-"`
	Arch        uint32      `json:"-"`
	Files       []ModelFile `json:"-"`
}

type ModelFile struct {
	Name, URL, SHA string
	Size           int64
}

var Catalog = []Model{
	{ID: "tiny", Name: "Whisper Tiny", Size: 77691713, Description: "Fastest · short dictation", SHA: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"},
	{ID: "base", Name: "Whisper Base", Size: 147951465, Description: "Lightweight · everyday dictation", SHA: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"},
	{ID: "small", Name: "Whisper Small", Size: 487601967, Description: "Balanced · better accuracy", SHA: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"},
	{ID: "medium", Name: "Whisper Medium", Size: 1533763059, Description: "Higher accuracy · more memory", SHA: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208"},
	{ID: "large-v3", Name: "Whisper Large v3", Size: 3095033483, Description: "Large v3 · highest memory use", SHA: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2"},
	{ID: "parakeet-tdt-0.6b-v3", Name: "NVIDIA Parakeet TDT v3", Kind: "parakeet", Filename: "parakeet-tdt-0.6b-v3.q8_0.gguf", Size: 713975456, Description: "25 European languages · automatic detection", SHA: "e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e", URL: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/resolve/541d1f99c6b0c3cd0b11a95167540bb8edefd82b/parakeet-tdt-0.6b-v3.q8_0.gguf"},
	{ID: "moonshine-v2-tiny", Name: "Moonshine V2 Tiny", Kind: "moonshine", Arch: 2, Size: 45233659, Description: "English only · fastest", Files: []ModelFile{
		{Name: "adapter.ort", URL: "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/adapter.ort", Size: 1319664, SHA: "crc32c:kwQ+Bw=="},
		{Name: "cross_kv.ort", URL: "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/cross_kv.ort", Size: 1287544, SHA: "crc32c:76wzFQ=="},
		{Name: "decoder_kv.ort", URL: "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/decoder_kv.ort", Size: 32583720, SHA: "crc32c:KJjeNw=="},
		{Name: "encoder.ort", URL: "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/encoder.ort", Size: 7675440, SHA: "crc32c:UjAIpQ=="},
		{Name: "frontend.model.ort", URL: "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/frontend.model.ort", Size: 23344, SHA: "crc32c:aM/+wQ=="},
		{Name: "frontend.weights.ort", URL: "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/frontend.weights.ort", Size: 2093464, SHA: "crc32c:WYZ7EQ=="},
		{Name: "streaming_config.json", URL: "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/streaming_config.json", Size: 509, SHA: "crc32c:HGL0Ug=="},
		{Name: "tokenizer.bin", URL: "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21/tokenizer.bin", Size: 249974, SHA: "crc32c:B7s10Q=="},
	}},
	{ID: "moonshine-v2-small", Name: "Moonshine V2 Small", Kind: "moonshine", Arch: 4, Size: 142300974, Description: "English only · very fast", Files: []ModelFile{
		{Name: "adapter.ort", URL: "https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/adapter.ort", Size: 2870368, SHA: "crc32c:XlWjTg=="},
		{Name: "cross_kv.ort", URL: "https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/cross_kv.ort", Size: 5356536, SHA: "crc32c:5ySK8g=="},
		{Name: "decoder_kv.ort", URL: "https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/decoder_kv.ort", Size: 81878600, SHA: "crc32c:Rn/VUA=="},
		{Name: "encoder.ort", URL: "https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/encoder.ort", Size: 44148576, SHA: "crc32c:41D2jQ=="},
		{Name: "frontend.model.ort", URL: "https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/frontend.model.ort", Size: 26944, SHA: "crc32c:WW2/2g=="},
		{Name: "frontend.weights.ort", URL: "https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/frontend.weights.ort", Size: 7769464, SHA: "crc32c:9pROuQ=="},
		{Name: "streaming_config.json", URL: "https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/streaming_config.json", Size: 512, SHA: "crc32c:dPbFiw=="},
		{Name: "tokenizer.bin", URL: "https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/tokenizer.bin", Size: 249974, SHA: "crc32c:B7s10Q=="},
	}},
	{ID: "moonshine-v2-medium", Name: "Moonshine V2 Medium", Kind: "moonshine", Arch: 5, Size: 269141623, Description: "English only · better accuracy", Files: []ModelFile{
		{Name: "adapter.ort", URL: "https://download.moonshine.ai/model/medium-streaming-en/quantized_26_08_21/adapter.ort", Size: 3651296, SHA: "crc32c:Ds3Hsg=="},
		{Name: "cross_kv.ort", URL: "https://download.moonshine.ai/model/medium-streaming-en/quantized_26_08_21/cross_kv.ort", Size: 11643776, SHA: "crc32c:liqlOg=="},
		{Name: "decoder_kv.ort", URL: "https://download.moonshine.ai/model/medium-streaming-en/quantized_26_08_21/decoder_kv.ort", Size: 146972408, SHA: "crc32c:GPnzeQ=="},
		{Name: "encoder.ort", URL: "https://download.moonshine.ai/model/medium-streaming-en/quantized_26_08_21/encoder.ort", Size: 94705376, SHA: "crc32c:yWvDwA=="},
		{Name: "frontend.model.ort", URL: "https://download.moonshine.ai/model/medium-streaming-en/quantized_26_08_21/frontend.model.ort", Size: 28720, SHA: "crc32c:k1kKsQ=="},
		{Name: "frontend.weights.ort", URL: "https://download.moonshine.ai/model/medium-streaming-en/quantized_26_08_21/frontend.weights.ort", Size: 11889560, SHA: "crc32c:w5QjIA=="},
		{Name: "streaming_config.json", URL: "https://download.moonshine.ai/model/medium-streaming-en/quantized_26_08_21/streaming_config.json", Size: 513, SHA: "crc32c:+1bE9Q=="},
		{Name: "tokenizer.bin", URL: "https://download.moonshine.ai/model/medium-streaming-en/quantized_26_08_21/tokenizer.bin", Size: 249974, SHA: "crc32c:B7s10Q=="},
	}},
	{ID: "moonshine-base", Name: "Moonshine Base", Kind: "moonshine", Arch: 1, Size: 141001190, Description: "English only · lightweight", Files: []ModelFile{
		{Name: "decoder_model_merged.ort", URL: "https://download.moonshine.ai/model/base-en/quantized/base-en/decoder_model_merged.ort", Size: 109424400, SHA: "crc32c:71VpRQ=="},
		{Name: "encoder_model.ort", URL: "https://download.moonshine.ai/model/base-en/quantized/base-en/encoder_model.ort", Size: 31326816, SHA: "crc32c:+MATVw=="},
		{Name: "tokenizer.bin", URL: "https://download.moonshine.ai/model/base-en/quantized/base-en/tokenizer.bin", Size: 249974, SHA: "crc32c:B7s10Q=="},
	}},
}

func List(dir string) []Model {
	list := append([]Model{}, Catalog...)
	for i := range list {
		p := modelPath(dir, list[i])
		if len(list[i].Files) > 0 {
			list[i] = listBundle(dir, list[i], p)
			continue
		}
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
	h, digest := newDigest(hash)
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
	if digest() != hash {
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
			if len(m.Files) > 0 {
				return installBundle(ctx, dir, m, report)
			}
			if m.URL != "" {
				return installModel(ctx, dir, m, m.URL, report)
			}
			return installModel(ctx, dir, m, "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-"+id+".bin", report)
		}
	}
	return "", fmt.Errorf("unknown model %q", id)
}
func installModel(ctx context.Context, dir string, model Model, url string, report func(int64, int64)) (string, error) {
	dest := modelPath(dir, model)
	if err := ctx.Err(); err != nil {
		return dest, err
	}
	root, err := managedModelDirectory(dir)
	if err != nil {
		return dest, err
	}
	dest = filepath.Join(root, filepath.Base(dest))
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
		if ValidateRuntime(ctx, path) == nil {
			return path, nil
		}
		if err := ctx.Err(); err != nil {
			return "", err
		}
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
