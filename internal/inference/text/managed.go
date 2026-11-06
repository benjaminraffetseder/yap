package text

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"yap/internal/models"
	"yap/internal/process"
)

// Managed resolves built-in connections at request time. Saved configurations
// contain stable model IDs, never worker ports or credentials. External requests
// continue to use the same Local client without starting a worker.
type Managed struct {
	Dir            string
	mu             sync.Mutex
	worker         *textWorker
	idle           *time.Timer
	idleGeneration uint64
	closed         bool
}

type textWorker struct {
	model         string
	context       int
	endpoint, key string
	cmd           *exec.Cmd
	done          chan struct{}
	closeJob      func()
}

func (m *Managed) stopLocked() {
	m.idleGeneration++
	if m.idle != nil {
		m.idle.Stop()
		m.idle = nil
	}
	if w := m.worker; w != nil {
		m.worker = nil
		w.closeJob()
		_ = w.cmd.Process.Kill()
		<-w.done
	}
}

func (m *Managed) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	m.stopLocked()
}

// Release is used when settings change or a model is removed, without closing
// the engine for subsequent requests.
func (m *Managed) Release() { m.mu.Lock(); defer m.mu.Unlock(); m.stopLocked() }

func (m *Managed) connection(ctx context.Context, c Config) (Config, error) {
	c, err := Normalize(c)
	if err != nil {
		return c, err
	}
	if err = ctx.Err(); err != nil {
		return c, err
	}
	if m.closed {
		return c, errors.New("text runtime is shutting down")
	}
	if c.Provider != "builtin" {
		return c, nil
	}
	if !models.TextRuntimeAvailable() {
		return c, errors.New("built-in text models currently require Windows x64; choose an external server")
	}
	length := c.ContextLength
	if length == 0 {
		length = models.RecommendedTextContext()
	}
	if w := m.worker; w != nil {
		select {
		case <-w.done:
			m.stopLocked()
		default:
		}
	}
	if w := m.worker; w != nil && (w.model != c.Model || w.context != length) {
		m.stopLocked()
	}
	if m.worker == nil {
		path, e := models.VerifiedTextModelPath(ctx, m.Dir, c.Model)
		if e != nil {
			return c, e
		}
		// The Vulkan build selects a compatible GPU when one is available. A
		// failed GPU initialization/allocation gets one CPU fallback attempt.
		for _, backend := range []string{"vulkan", "cpu"} {
			m.worker, err = startTextWorker(ctx, models.TextRuntimePath(m.Dir, backend), path, c.Model, length, backend)
			if err == nil || ctx.Err() != nil {
				break
			}
		}
		if err != nil {
			return c, err
		}
	}
	c.Endpoint, c.APIKey, c.ContextLength = m.worker.endpoint, m.worker.key, length
	return c, nil
}

func startTextWorker(ctx context.Context, executable, path, model string, length int, backend string) (*textWorker, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	var secret [32]byte
	if _, err = rand.Read(secret[:]); err != nil {
		return nil, err
	}
	key := hex.EncodeToString(secret[:])
	layers := "0"
	if backend == "vulkan" {
		layers = "auto"
	}
	args := []string{"--model", path, "--alias", model, "--host", "127.0.0.1", "--port", strconv.Itoa(port), "--ctx-size", strconv.Itoa(length), "--parallel", "1", "--n-gpu-layers", layers, "--jinja", "--reasoning", "off", "--api-key", key, "--no-webui", "--no-context-shift"}
	cmd := exec.Command(executable, args...)
	cmd.Dir = filepath.Dir(executable)
	// Runtime output can contain input text; never forward it to UI errors/logs.
	cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
	closeJob, err := process.StartManaged(cmd)
	if err != nil {
		return nil, errors.New("text runtime could not start; download the model again to repair its runtime")
	}
	w := &textWorker{model: model, context: length, endpoint: "http://127.0.0.1:" + strconv.Itoa(port) + "/v1", key: key, cmd: cmd, done: make(chan struct{}), closeJob: closeJob}
	go func() { _ = cmd.Wait(); close(w.done) }()
	client, closeClient := localHTTPClient(time.Second)
	defer closeClient()
	warmup, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		req, _ := http.NewRequestWithContext(warmup, http.MethodGet, "http://127.0.0.1:"+strconv.Itoa(port)+"/health", nil)
		req.Header.Set("Authorization", "Bearer "+key)
		resp, e := client.Do(req)
		if e == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return w, nil
			}
		}
		select {
		case <-warmup.Done():
			closeJob()
			_ = cmd.Process.Kill()
			<-w.done
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, errors.New("text model took too long to load; reduce context length or choose a smaller model")
		case <-w.done:
			closeJob()
			return nil, errors.New("text model could not load; reduce context length, free memory, or download the model again")
		case <-ticker.C:
		}
	}
}

func (m *Managed) use(ctx context.Context, c Config, run func(Config) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.idleGeneration++
	if m.idle != nil {
		m.idle.Stop()
	}
	c, err := m.connection(ctx, c)
	if err == nil {
		err = run(c)
	}
	if m.worker != nil {
		generation := m.idleGeneration
		m.idle = time.AfterFunc(2*time.Minute, func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.idleGeneration == generation {
				m.stopLocked()
			}
		})
	}
	return err
}

func (m *Managed) Process(ctx context.Context, c Config, p Prompt, input string) (string, error) {
	out, _, err := m.ProcessWithStats(ctx, c, p, input)
	return out, err
}
func (m *Managed) ProcessWithStats(ctx context.Context, c Config, p Prompt, input string) (out string, stats *Stats, err error) {
	err = m.use(ctx, c, func(c Config) error {
		var e error
		out, stats, e = (Local{}).ProcessWithStats(ctx, c, p, input)
		return e
	})
	return
}
func (m *Managed) Refine(ctx context.Context, c Config, input string) (out string, err error) {
	err = m.use(ctx, c, func(c Config) error { var e error; out, e = (Local{}).Refine(ctx, c, input); return e })
	return
}
func (m *Managed) Chat(ctx context.Context, c Config, messages []Message, onText func(string)) (out string, err error) {
	err = m.use(ctx, c, func(c Config) error { var e error; out, e = (Local{}).Chat(ctx, c, messages, onText); return e })
	return
}
