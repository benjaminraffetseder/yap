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

type Options struct{ Executable, Model, Language string }
type Engine interface {
	Transcribe(context.Context, string, Options) (string, error)
}
type Whisper struct{}

func Validate(opts Options) error {
	if opts.Executable == "" {
		return fmt.Errorf("install Whisper in Models, or select a whisper-cli executable")
	}
	if _, err := exec.LookPath(opts.Executable); err != nil {
		return fmt.Errorf("Whisper executable is unavailable: %w", err)
	}
	info, err := os.Stat(opts.Model)
	if err != nil || info.IsDir() {
		return fmt.Errorf("select an installed Whisper model in Models")
	}
	return nil
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
	cmd := exec.CommandContext(ctx, opts.Executable, "-m", opts.Model, "-f", audio, "-l", opts.Language, "-otxt", "-of", out, "-nt", "-np")
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
		return "", fmt.Errorf("no speech detected; try a longer recording")
	}
	return text, nil
}
