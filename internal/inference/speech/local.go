package speech

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"yap/internal/process"
)

// Bundle describes the files needed by Moonshine's native runtime.
type Bundle struct {
	Arch  uint32       `json:"arch"`
	Files []BundleFile `json:"files"`
}
type BundleFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

const BundleManifest = "yap-model.json"

func Kind(model string) string {
	if strings.EqualFold(filepath.Ext(model), ".gguf") {
		return "parakeet"
	}
	if strings.HasPrefix(filepath.Base(model), "moonshine-") {
		return "moonshine"
	}
	return "whisper"
}

func RuntimePath(dir, kind string) string {
	switch kind {
	case "parakeet":
		name := "nemo-speech"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		return filepath.Join(dir, "runtime", "nemo-speech-0.2.0", "bin", name)
	case "moonshine":
		name := "libmoonshine.so"
		if runtime.GOOS == "windows" {
			name = "moonshine.dll"
		}
		if runtime.GOOS == "darwin" {
			name = "libmoonshine.dylib"
		}
		return filepath.Join(dir, "runtime", "moonshine-0.1.5", "moonshine_voice", name)
	}
	return ""
}

func RuntimeFor(opts Options) string {
	if Kind(opts.Model) == "whisper" {
		return opts.Executable
	}
	return RuntimePath(filepath.Dir(filepath.Dir(opts.Model)), Kind(opts.Model))
}

func ValidateRuntimeFor(opts Options) error {
	if Kind(opts.Model) == "whisper" {
		return ValidateExecutable(opts.Executable)
	}
	if err := regularFile(RuntimeFor(opts)); err != nil {
		return fmt.Errorf("speech runtime is unavailable; reinstall the model in Models: %w", err)
	}
	return nil
}

func regularFile(path string) error {
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || st.Size() == 0 {
		return fmt.Errorf("empty or invalid file: %s", path)
	}
	return nil
}

func ReadBundle(model string) (Bundle, error) {
	var b Bundle
	st, err := os.Lstat(model)
	if err != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		return b, fmt.Errorf("Moonshine model folder is unavailable; reinstall it in Models")
	}
	data, err := os.ReadFile(filepath.Join(model, BundleManifest))
	if err != nil {
		return b, err
	}
	if err = json.Unmarshal(data, &b); err != nil {
		return b, err
	}
	if b.Arch != 1 && b.Arch != 2 && b.Arch != 4 && b.Arch != 5 {
		return b, fmt.Errorf("unsupported Moonshine architecture")
	}
	if len(b.Files) == 0 {
		return b, fmt.Errorf("Moonshine model has no files")
	}
	for _, f := range b.Files {
		if filepath.Base(f.Name) != f.Name || strings.ContainsAny(f.Name, "/\\:") || f.Size <= 0 {
			return b, fmt.Errorf("invalid model manifest")
		}
		st, err := os.Lstat(filepath.Join(model, f.Name))
		if err != nil || !st.Mode().IsRegular() || st.Size() != f.Size {
			return b, fmt.Errorf("Moonshine model is incomplete; reinstall it in Models")
		}
	}
	return b, nil
}

// Local routes a selected model to its native engine. Whisper settings are
// retained so switching back to a Whisper model keeps the custom runtime.
type Local struct{}

func (Local) Transcribe(ctx context.Context, audio string, opts Options) (string, error) {
	if Kind(opts.Model) == "whisper" {
		return (Whisper{}).Transcribe(ctx, audio, opts)
	}
	if err := Validate(opts); err != nil {
		return "", err
	}
	if Kind(opts.Model) == "moonshine" && opts.Language != "" && opts.Language != "auto" && opts.Language != "en" {
		return "", fmt.Errorf("this Moonshine model supports English only; choose English or Auto in Settings, or select a multilingual model")
	}
	dir, err := os.MkdirTemp("", "yap-transcript-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	out := filepath.Join(dir, "transcript.txt")
	executable := RuntimeFor(opts)
	args := []string{"transcribe", audio, "--model", opts.Model, "--format", "text", "--output", out}
	if Kind(opts.Model) == "moonshine" {
		executable, err = os.Executable()
		if err != nil {
			return "", err
		}
		args = []string{"--yap-moonshine-worker", RuntimeFor(opts), opts.Model, audio, out, opts.Prompt}
	}
	cmd := exec.CommandContext(ctx, executable, args...)
	process.Hide(cmd)
	log, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if len(log) > 2000 {
			log = log[len(log)-2000:]
		}
		return "", fmt.Errorf("%s transcription failed: %w\n%s", Kind(opts.Model), err, strings.TrimSpace(string(log)))
	}
	data, err := os.ReadFile(out)
	if err != nil {
		return "", fmt.Errorf("speech runtime produced no transcript: %w", err)
	}
	text := strings.TrimSpace(string(data))
	if text == "" {
		return "", ErrNoSpeech
	}
	return text, nil
}
