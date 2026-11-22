package speech

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"yap/internal/process"
)

const nativeWorkerFlag = "--yap-native-speech-worker"
const maxRequest = 256 << 10
const maxReply = 8 << 20

type speechRequest struct{ Audio, Language, Prompt string }
type speechReply struct{ Text, Error string }
type nativeWorker struct {
	input  io.WriteCloser
	output io.ReadCloser
	done   chan struct{}
	kill   func()
}

func startNativeWorker(ctx context.Context, exe string, args []string) (warmWorker, error) {
	cmd := exec.Command(exe, args...)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	cleanup, err := process.StartManaged(cmd)
	if err != nil {
		in.Close()
		out.Close()
		return nil, err
	}
	w := &nativeWorker{input: in, output: out, done: make(chan struct{}), kill: sync.OnceFunc(func() { cleanup(); _ = cmd.Process.Kill() })}
	go func() {
		_ = cmd.Wait()
		w.kill()
		close(w.done)
	}()
	startup, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	var ready speechReply
	err = w.interruptible(startup, func() error { return readFrame(out, &ready, maxReply) })
	if err != nil || ready.Error != "" || ready.Text != "ready" {
		w.close()
		if startup.Err() != nil {
			return nil, startup.Err()
		}
		return nil, errors.New("speech runtime could not load the model; free memory or repair the runtime in Models")
	}
	return w, nil
}
func (w *nativeWorker) exited() bool {
	select {
	case <-w.done:
		return true
	default:
		return false
	}
}
func (w *nativeWorker) close() {
	// EOF lets an idle worker destroy the native handle and unload the library.
	_ = w.input.Close()
	select {
	case <-w.done:
	case <-time.After(time.Second):
		w.kill()
		<-w.done
	}
}
func (w *nativeWorker) interruptible(ctx context.Context, fn func() error) error {
	stop := context.AfterFunc(ctx, w.kill)
	err := fn()
	stop()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}
func (w *nativeWorker) transcribe(ctx context.Context, audio string, opts Options) (string, error) {
	var reply speechReply
	err := w.interruptible(ctx, func() error {
		if err := writeFrame(w.input, speechRequest{audio, opts.Language, opts.Prompt}, maxRequest); err != nil {
			return err
		}
		return readFrame(w.output, &reply, maxReply)
	})
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", errors.New("speech worker stopped before completing transcription; retry or select a smaller model")
	}
	if reply.Error != "" {
		return "", errors.New(reply.Error)
	}
	text := strings.TrimSpace(reply.Text)
	if text == "" {
		return "", ErrNoSpeech
	}
	return text, nil
}

func writeFrame(w io.Writer, v any, limit int) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(data) > limit {
		return errors.New("speech worker message too large")
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(data)))
	if _, err = w.Write(header[:]); err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}
func readFrame(r io.Reader, v any, limit int) error {
	var header [4]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return err
	}
	n := binary.BigEndian.Uint32(header[:])
	if n == 0 || n > uint32(limit) {
		return errors.New("invalid speech worker message size")
	}
	data := make([]byte, n)
	if _, err := io.ReadFull(r, data); err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

type nativeTranscribe func(speechRequest) (string, error)

func serveNative(in io.Reader, out io.Writer, run nativeTranscribe) error {
	if err := writeFrame(out, speechReply{Text: "ready"}, maxReply); err != nil {
		return err
	}
	for {
		var req speechRequest
		err := readFrame(in, &req, maxRequest)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		text, err := run(req)
		reply := speechReply{Text: text}
		if err != nil {
			reply = speechReply{Error: err.Error()}
		}
		if err = writeFrame(out, reply, maxReply); err != nil {
			return err
		}
	}
}

func runNative(args []string) error {
	if len(args) != 3 {
		return errors.New("invalid native worker arguments")
	}
	lib, done, err := openSpeechLibrary(args[1])
	if err != nil {
		return err
	}
	defer done()
	var run nativeTranscribe
	var unload func()
	switch Kind(args[2]) {
	case "moonshine":
		run, unload, err = loadMoonshine(lib, args[2])
	case "parakeet":
		run, unload, err = loadParakeet(lib, args[2])
	default:
		return errors.New("unsupported native worker model")
	}
	if err != nil {
		return err
	}
	defer unload()
	return serveNative(os.Stdin, os.Stdout, run)
}
