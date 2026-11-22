package speech

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"

	"github.com/ebitengine/purego"
)

// Capture and imports use this PCM format. Other caller-supplied audio stays
// with the CLI's broader decoder and channel/sample-rate conversion.
func parakeetPCM(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	var h [36]byte
	if _, err = io.ReadFull(f, h[:]); err != nil {
		return false
	}
	return string(h[:4]) == "RIFF" && string(h[8:16]) == "WAVEfmt " &&
		binary.LittleEndian.Uint16(h[20:]) == 1 && binary.LittleEndian.Uint16(h[22:]) == 1 &&
		binary.LittleEndian.Uint32(h[24:]) == 16000 && binary.LittleEndian.Uint16(h[34:]) == 16
}

func parakeetLibrary(opts Options) string {
	bin := filepath.Dir(RuntimeFor(opts))
	path := filepath.Join(bin, "nemo_speech_asr_c.dll")
	if runtime.GOOS != "windows" {
		name := "libnemo_speech_asr_c.so"
		if runtime.GOOS == "darwin" {
			name = "libnemo_speech_asr_c.dylib"
		}
		path = filepath.Join(filepath.Dir(bin), "lib", name)
	}
	if regularFile(path) != nil {
		return ""
	}
	return path
}

// The v0.3.0 installed asr.h ABI accepts append-only structs with their
// supplied size. Only the prefixes used here are exposed to the library.
type nemoModel struct {
	size uintptr
	path *byte
}
type nemoBackend struct {
	size uintptr
	gpu  int32
}
type nemoConfig struct {
	size    uintptr
	backend *nemoBackend
	model   *nemoModel
}
type nemoOptions struct {
	size      uintptr
	requestID uintptr
	language  *byte
}

func cString(s string) *byte { return &append([]byte(s), 0)[0] }

func loadParakeet(h uintptr, path string) (nativeTranscribe, func(), error) {
	var create func(*nemoConfig, *uintptr) int32
	var destroy, freeResult func(uintptr)
	var recognize func(uintptr, *nemoOptions, *float32, uintptr, int32, *uintptr) int32
	var transcript func(uintptr, uintptr) string
	purego.RegisterLibFunc(&create, h, "nemo_speech_asr_create")
	purego.RegisterLibFunc(&destroy, h, "nemo_speech_asr_destroy")
	purego.RegisterLibFunc(&recognize, h, "nemo_speech_asr_recognize_f32")
	purego.RegisterLibFunc(&transcript, h, "nemo_speech_asr_result_transcript")
	purego.RegisterLibFunc(&freeResult, h, "nemo_speech_asr_result_destroy")
	model := nemoModel{size: unsafe.Sizeof(nemoModel{}), path: cString(path)}
	// The managed releases are CPU-only except for the Apple Silicon Metal build.
	backend := nemoBackend{size: unsafe.Sizeof(nemoBackend{}), gpu: -1}
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		backend.gpu = 0
	}
	cfg := nemoConfig{size: unsafe.Sizeof(nemoConfig{}), model: &model, backend: &backend}
	var handle uintptr
	code := create(&cfg, &handle)
	runtime.KeepAlive(cfg)
	if code != 0 || handle == 0 {
		return nil, nil, fmt.Errorf("Parakeet could not load the model (%d)", code)
	}
	run := func(req speechRequest) (string, error) {
		samples, err := readPCM(req.Audio)
		if err != nil {
			return "", err
		}
		opts := nemoOptions{size: unsafe.Sizeof(nemoOptions{})}
		if req.Language != "" && !strings.EqualFold(req.Language, "auto") {
			opts.language = cString(req.Language)
		}
		// The bundled greedy decoder does not implement vocabulary boosting.
		var result uintptr
		code := recognize(handle, &opts, &samples[0], uintptr(len(samples)), 16000, &result)
		runtime.KeepAlive(samples)
		runtime.KeepAlive(opts)
		if result != 0 {
			defer freeResult(result)
		}
		if code != 0 || result == 0 {
			return "", fmt.Errorf("Parakeet transcription failed (%d); free memory or choose a smaller model", code)
		}
		return transcript(result, 0), nil
	}
	return run, func() { destroy(handle) }, nil
}
