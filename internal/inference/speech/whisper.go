package speech

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"yap/internal/process"
)

type Options struct {
	Executable, Model, Language, Prompt string
	Progress                            func(float64)
}
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
	if Kind(model) == "moonshine" {
		_, err := ReadBundle(model)
		return err
	}
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
	if err := ValidateRuntimeFor(opts); err != nil {
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
	args := []string{"-m", opts.Model, "-f", audio, "-l", opts.Language, "-otxt", "-of", out, "-nt", "-pp"}
	if opts.Prompt != "" {
		args = append(args, "--prompt", opts.Prompt)
	}
	cmd := exec.CommandContext(ctx, opts.Executable, args...)
	process.Hide(cmd)
	log := &progressLog{progress: opts.Progress}
	cmd.Stderr = log
	err = cmd.Run()
	log.flush()
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		message := string(log.tail)
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

var progressPattern = regexp.MustCompile(`\bprogress\s*=\s*([0-9]+)%`)

func parseProgress(line string) (float64, bool) {
	match := progressPattern.FindStringSubmatch(line)
	if match == nil {
		return 0, false
	}
	n, err := strconv.Atoi(match[1])
	return float64(n), err == nil && n >= 0 && n <= 100
}

// Bound both the diagnostic tail and unterminated lines. Writes can split lines.
type progressLog struct {
	tail, line []byte
	progress   func(float64)
}

func (w *progressLog) Write(p []byte) (int, error) {
	w.tail = append(w.tail, p...)
	if len(w.tail) > 2000 {
		w.tail = append([]byte(nil), w.tail[len(w.tail)-2000:]...)
	}
	for _, b := range p {
		if b == '\n' || b == '\r' {
			w.flush()
		} else {
			if len(w.line) == 2000 {
				w.line = w.line[:0]
			}
			w.line = append(w.line, b)
		}
	}
	return len(p), nil
}

func (w *progressLog) flush() {
	if value, ok := parseProgress(string(w.line)); ok && w.progress != nil {
		w.progress(value)
	}
	w.line = w.line[:0]
}
