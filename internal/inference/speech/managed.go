package speech

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Managed serializes inference and retains one isolated model between requests.
type Managed struct {
	dir         string
	whisperPair whisperPair
	idleTimeout time.Duration
	start       func(context.Context, string, Options) (warmWorker, error)
	mu          sync.Mutex // protects admission and lifetime changes
	lifetime    context.Context
	cancel      context.CancelFunc
	gate        chan struct{} // owns worker, files, and idle timer
	worker      warmWorker
	files       []workerFile
	idle        *time.Timer
}

type warmWorker interface {
	transcribe(context.Context, string, Options) (string, error)
	close()
	exited() bool
}

func NewManaged(dir string) *Managed {
	m := &Managed{dir: dir, idleTimeout: 2 * time.Minute, start: startSpeechWorker, gate: make(chan struct{}, 1)}
	m.whisperPair, _ = pinnedWhisperPair(runtime.GOOS + "/" + runtime.GOARCH)
	m.lifetime, m.cancel = context.WithCancel(context.Background())
	return m
}

func (m *Managed) stop() {
	if m.idle != nil {
		m.idle.Stop()
		m.idle = nil
	}
	if m.worker != nil {
		m.worker.close()
		m.worker = nil
	}
	m.files = nil
}

// Release cancels queued and active requests and waits for process cleanup.
func (m *Managed) Release() { m.release(false) }
func (m *Managed) Close()   { m.release(true) }
func (m *Managed) release(terminal bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lifetime == nil {
		return
	}
	m.cancel()
	m.gate <- struct{}{}
	defer func() { <-m.gate }()
	m.stop()
	if terminal {
		m.lifetime = nil
	} else {
		m.lifetime, m.cancel = context.WithCancel(context.Background())
	}
}

func (m *Managed) Transcribe(ctx context.Context, audio string, opts Options) (string, error) {
	m.mu.Lock()
	life := m.lifetime
	m.mu.Unlock()
	if life == nil {
		return "", errors.New("speech runtime is closed")
	}
	select {
	case m.gate <- struct{}{}:
	case <-ctx.Done():
		return "", ctx.Err()
	case <-life.Done():
		return "", life.Err()
	}
	defer func() { <-m.gate }()
	if err := life.Err(); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Hour)
	stop := context.AfterFunc(life, cancel)
	defer func() { stop(); cancel() }()
	if m.idle != nil {
		m.idle.Stop()
		m.idle = nil
	}
	path := m.runtime(opts)
	if path != "" && Kind(opts.Model) == "parakeet" && !parakeetPCM(audio) {
		path = ""
	}
	// Large recordings still use the file-based CLI, keeping the server's
	// multipart upload budget independent of supported recording duration.
	if path != "" && Kind(opts.Model) == "whisper" {
		if info, err := os.Stat(audio); err == nil && info.Size() > maxServerAudio {
			path = ""
		}
	}
	if path == "" {
		m.stop()
		return (Local{}).Transcribe(ctx, audio, opts)
	}
	if err := Validate(opts); err != nil {
		m.stop()
		return "", err
	}
	files, err := workerFiles(path, opts)
	if err != nil {
		m.stop()
		if Kind(opts.Model) == "whisper" {
			return (Local{}).Transcribe(ctx, audio, opts)
		}
		return "", err
	}
	if m.worker != nil && (m.worker.exited() || !sameFiles(m.files, files)) {
		m.stop()
	}
	if m.worker == nil {
		// Metadata can justify reusing a living worker, but it cannot authenticate
		// executables for a new process after exit, idle expiry, or a model change.
		if Kind(opts.Model) == "whisper" && !m.whisperPair.matchesDigests(opts.Executable, path) {
			return (Local{}).Transcribe(ctx, audio, opts)
		}
		m.worker, err = m.start(ctx, path, opts)
		if err != nil {
			return "", err
		}
		m.files = files
	}
	result, err := m.worker.transcribe(ctx, audio, opts)
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil && !errors.Is(err, ErrNoSpeech) {
		m.stop()
		return "", err
	}
	var timer *time.Timer
	timer = time.AfterFunc(m.idleTimeout, func() {
		m.gate <- struct{}{}
		defer func() { <-m.gate }()
		if m.idle == timer {
			m.stop()
		}
	})
	m.idle = timer
	return result, err
}

func (m *Managed) runtime(opts Options) string {
	switch Kind(opts.Model) {
	case "moonshine":
		return RuntimeFor(opts)
	case "parakeet":
		return parakeetLibrary(opts)
	default:
		return m.whisperPair.serverPath(m.dir, opts.Executable)
	}
}
func startSpeechWorker(ctx context.Context, path string, opts Options) (warmWorker, error) {
	if Kind(opts.Model) == "whisper" {
		return startWhisperServer(ctx, path, opts)
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return startNativeWorker(ctx, executable, []string{nativeWorkerFlag, path, opts.Model})
}

type workerFile struct {
	path string
	info os.FileInfo
}

func workerFiles(path string, opts Options) ([]workerFile, error) {
	paths := []string{opts.Model, path, RuntimeFor(opts)}
	if Kind(opts.Model) == "moonshine" {
		b, err := ReadBundle(opts.Model)
		if err != nil {
			return nil, err
		}
		paths = append(paths, filepath.Join(opts.Model, BundleManifest))
		for _, f := range b.Files {
			paths = append(paths, filepath.Join(opts.Model, f.Name))
		}
	}
	// The Windows releases ship their DLLs beside the executable. Unix releases
	// can also load from the neighbouring lib directory.
	dirs := []string{filepath.Dir(path)}
	if filepath.Base(dirs[0]) == "bin" {
		dirs = append(dirs, filepath.Join(filepath.Dir(dirs[0]), "lib"))
	}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			name := strings.ToLower(e.Name())
			if strings.HasSuffix(name, ".dll") || strings.HasSuffix(name, ".dylib") || strings.HasSuffix(name, ".so") || strings.Contains(name, ".so.") {
				paths = append(paths, filepath.Join(dir, e.Name()))
			}
		}
	}
	files := make([]workerFile, 0, len(paths))
	seen := make(map[string]bool)
	for _, p := range paths {
		if seen[p] {
			continue
		}
		seen[p] = true
		// Capture identity now. On Windows os.Stat can defer looking up the
		// file ID until SameFile, by which time the path may be replaced.
		f, err := os.Open(p)
		if err != nil {
			return nil, err
		}
		info, err := f.Stat()
		f.Close()
		if err != nil {
			return nil, err
		}
		files = append(files, workerFile{p, info})
	}
	return files, nil
}
func sameFiles(a, b []workerFile) bool {
	if len(a) != len(b) {
		return false
	}
	for i, f := range a {
		g := b[i]
		if f.path != g.path || f.info.Size() != g.info.Size() || !f.info.ModTime().Equal(g.info.ModTime()) || !os.SameFile(f.info, g.info) {
			return false
		}
	}
	return true
}
