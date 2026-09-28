package speech

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"yap/internal/process"
)

type Options struct{ Executable, Model, Language, Prompt string }
type Engine interface {
	Transcribe(context.Context, string, Options) (string, error)
}
type Whisper struct{}

var ErrNoSpeech = fmt.Errorf("no speech detected; try a longer recording")

func ValidateExecutable(executable string) error {
	if executable == "" {
		return fmt.Errorf("install Whisper in Models, or select a whisper-cli executable in Settings")
	}
	path, err := exec.LookPath(executable)
	if err != nil {
		return fmt.Errorf("Whisper executable is unavailable; select whisper-cli in Settings: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("select a regular whisper-cli executable in Settings")
	}
	return nil
}

func ValidateModel(model string) error {
	f, err := os.Open(model)
	if err != nil {
		return fmt.Errorf("speech model is unavailable; download one in Models or select its file in Settings: %w", err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return fmt.Errorf("speech model is empty or invalid; download it again in Models")
	}
	return nil
}

func Validate(opts Options) error {
	if err := ValidateExecutable(opts.Executable); err != nil {
		return err
	}
	return ValidateModel(opts.Model)
}
func (Whisper) Transcribe(ctx context.Context, audio string, opts Options) (string, error) {
	if err := Validate(opts); err != nil {
		return "", err
	}
	dir, err := os.MkdirTemp("", "yap-transcript-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	out := filepath.Join(dir, "transcript")
	args := []string{"-m", opts.Model, "-f", audio, "-l", opts.Language, "-otxt", "-of", out, "-nt", "-np"}
	if opts.Prompt != "" {
		args = append(args, "--prompt", opts.Prompt)
	}
	cmd := exec.CommandContext(ctx, opts.Executable, args...)
	process.Hide(cmd)
	log, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		message := string(log)
		if len(message) > 2000 {
			message = message[len(message)-2000:]
		}
		return "", fmt.Errorf("Whisper failed: %w\n%s", err, strings.TrimSpace(message))
	}
	data, err := os.ReadFile(out + ".txt")
	if err != nil {
		return "", fmt.Errorf("Whisper produced no transcript: %w", err)
	}
	text := strings.TrimSpace(string(data))
	if text == "" {
		return "", ErrNoSpeech
	}
	return text, nil
}
