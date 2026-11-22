package speech

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"yap/internal/process"
)

const WhisperRuntimeVersion = "1.9.5"
const maxServerAudio = 64 << 20

type whisperServer struct {
	addr, prefix, inference string
	done                    chan struct{}
	kill                    func()
	progressMu              sync.Mutex
	progress                progressLog
}

func startWhisperServer(ctx context.Context, path string, opts Options) (warmWorker, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	addr := listener.Addr().(*net.TCPAddr)
	listener.Close()
	w := &whisperServer{addr: addr.String(), prefix: "/" + rand.Text(), inference: "/" + rand.Text(), done: make(chan struct{})}
	// Match the pinned CLI's beam size and best-of defaults.
	cmd := exec.Command(path, "-m", opts.Model, "--host", "127.0.0.1", "--port", fmt.Sprint(addr.Port), "--request-path", w.prefix, "--inference-path", w.inference, "-nt", "-pp", "-bs", "5", "-bo", "5")
	cmd.Dir = filepath.Dir(path)
	cmd.Stderr = w
	cleanup, err := process.StartManaged(cmd)
	if err != nil {
		return nil, errors.New("Whisper server could not start; repair the runtime in Models")
	}
	w.kill = sync.OnceFunc(cleanup)
	go func() {
		_ = cmd.Wait()
		w.kill()
		close(w.done)
	}()
	startup, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		conn, e := w.connect(startup)
		if e == nil {
			conn.Close()
			return w, nil
		}
		select {
		case <-startup.Done():
			w.close()
			return nil, startup.Err()
		case <-w.done:
			w.close()
			return nil, errors.New("Whisper server could not load the model; free memory or repair the runtime in Models")
		case <-ticker.C:
		}
	}
}
func (w *whisperServer) Write(data []byte) (int, error) {
	w.progressMu.Lock()
	defer w.progressMu.Unlock()
	if w.progress.progress != nil {
		return w.progress.Write(data)
	}
	return len(data), nil
}
func (w *whisperServer) exited() bool {
	select {
	case <-w.done:
		return true
	default:
		return false
	}
}
func (w *whisperServer) close() { w.kill(); <-w.done }

// Each new connection proves that it reaches our child before receiving audio.
// The child embeds its independently generated inference path in its HTML form.
// A process grabbing the port between discovery and bind cannot supply it.
func (w *whisperServer) connect(ctx context.Context) (net.Conn, error) {
	probe, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	conn, err := (&net.Dialer{}).DialContext(probe, "tcp4", w.addr)
	if err != nil {
		return nil, err
	}
	deadline, _ := probe.Deadline()
	_ = conn.SetDeadline(deadline)
	if err = w.verify(conn); err != nil {
		conn.Close()
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	return conn, nil
}

func (w *whisperServer) verify(conn io.ReadWriter) error {
	req, _ := http.NewRequest(http.MethodGet, "http://"+w.addr+w.prefix+"/", nil)
	if err := req.Write(conn); err != nil {
		return err
	}
	body, err := readServerResponse(conn, req, 64<<10)
	if err != nil {
		return err
	}
	if !bytes.Contains(body, []byte(`action="`+w.prefix+w.inference+`"`)) {
		return errors.New("unexpected Whisper server")
	}
	return nil
}

// Limit headers and body together, and reject truncated or oversized replies.
func readServerResponse(r io.Reader, req *http.Request, limit int64) ([]byte, error) {
	bounded := &io.LimitedReader{R: r, N: limit + 1}
	resp, err := http.ReadResponse(bufio.NewReader(bounded), req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Whisper server returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if bounded.N == 0 {
		return nil, errors.New("Whisper server reply too large")
	}
	return data, err
}

func (w *whisperServer) transcribe(ctx context.Context, audio string, opts Options) (string, error) {
	f, err := os.Open(audio)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if info.Size() > maxServerAudio || len(opts.Language)+len(opts.Prompt) > maxRequest {
		return "", errors.New("Whisper request too large")
	}
	// Keep audio on disk and give the pinned server a Content-Length.
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	for _, field := range [][2]string{{"response_format", "json"}, {"language", opts.Language}, {"prompt", opts.Prompt}} {
		if err = writer.WriteField(field[0], field[1]); err != nil {
			return "", err
		}
	}
	if _, err = writer.CreateFormFile("file", "recording.wav"); err != nil {
		return "", err
	}
	before := form.Len()
	if err = writer.Close(); err != nil {
		return "", err
	}
	data := form.Bytes()
	body := io.MultiReader(bytes.NewReader(data[:before]), io.LimitReader(f, info.Size()), bytes.NewReader(data[before:]))
	req, _ := http.NewRequest(http.MethodPost, "http://"+w.addr+w.prefix+w.inference, body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.ContentLength = info.Size() + int64(len(data))
	req.Close = true
	conn, err := w.connect(ctx)
	if err != nil {
		return "", errors.New("Whisper server is unavailable; retry transcription")
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	w.progressMu.Lock()
	w.progress = progressLog{progress: opts.Progress}
	w.progressMu.Unlock()
	defer func() { w.progressMu.Lock(); w.progress = progressLog{}; w.progressMu.Unlock() }()
	if err = req.Write(conn); err != nil {
		return "", errors.New("could not send audio to Whisper server")
	}
	reply, err := readServerResponse(conn, req, maxReply)
	if err != nil {
		return "", errors.New("Whisper server did not complete transcription")
	}
	var result struct{ Text *string }
	if json.Unmarshal(reply, &result) != nil || result.Text == nil {
		return "", errors.New("Whisper server returned an invalid transcript")
	}
	text := strings.TrimSpace(*result.Text)
	if text == "" {
		return "", ErrNoSpeech
	}
	return text, nil
}
