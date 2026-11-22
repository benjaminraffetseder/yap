package speech

import (
	"encoding/binary"
	"fmt"
	"os"
	"runtime"
	"strings"
	"unsafe"

	"github.com/ebitengine/purego"
)

// RunWorker handles the native child entry points before desktop startup.
func RunWorker(args []string) (handled bool, err error) {
	if len(args) == 0 || (args[0] != "--yap-moonshine-worker" && args[0] != "--yap-moonshine-check" && args[0] != nativeWorkerFlag) {
		return false, nil
	}
	handled = true
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("speech runtime: %v", p)
		}
	}()
	if args[0] == nativeWorkerFlag {
		return true, runNative(args)
	}
	if len(args) < 2 {
		return true, fmt.Errorf("missing Moonshine runtime")
	}
	h, closeLibrary, err := openSpeechLibrary(args[1])
	if err != nil {
		return true, err
	}
	defer closeLibrary()
	if args[0] == "--yap-moonshine-check" {
		return true, checkMoonshineVersion(h)
	}
	if len(args) != 6 {
		return true, fmt.Errorf("invalid Moonshine worker arguments")
	}
	run, unload, err := loadMoonshine(h, args[2])
	if err != nil {
		return true, err
	}
	defer unload()
	text, err := run(speechRequest{Audio: args[3], Prompt: args[5]})
	if err != nil {
		return true, err
	}
	return true, os.WriteFile(args[4], []byte(text), 0600)
}

func checkMoonshineVersion(h uintptr) error {
	var version func() int32
	purego.RegisterLibFunc(&version, h, "moonshine_get_version")
	if version() != 30000 {
		return fmt.Errorf("unsupported Moonshine runtime version")
	}
	return nil
}
func loadMoonshine(h uintptr, path string) (nativeTranscribe, func(), error) {
	if err := checkMoonshineVersion(h); err != nil {
		return nil, nil, err
	}
	bundle, err := ReadBundle(path)
	if err != nil {
		return nil, nil, err
	}
	var load func(string, uint32, uintptr, uint64, int32) int32
	var free func(int32)
	var transcribe func(int32, *float32, uint64, int32, uint32, **nativeTranscript) int32
	purego.RegisterLibFunc(&load, h, "moonshine_load_transcriber_from_files")
	purego.RegisterLibFunc(&free, h, "moonshine_free_transcriber")
	purego.RegisterLibFunc(&transcribe, h, "moonshine_transcribe_without_streaming")
	model := load(path, bundle.Arch, 0, 0, 30000)
	if model < 0 {
		return nil, nil, fmt.Errorf("Moonshine could not load model (%d)", model)
	}
	var keyterms func(int32, string) int32
	if bundle.Arch != 1 {
		purego.RegisterLibFunc(&keyterms, h, "moonshine_transcriber_set_keyterms")
	}
	run := func(req speechRequest) (string, error) {
		audio, err := readPCM(req.Audio)
		if err != nil {
			return "", err
		}
		if keyterms != nil {
			if code := keyterms(model, req.Prompt); code != 0 {
				return "", fmt.Errorf("Moonshine vocabulary failed (%d)", code)
			}
		}
		var result *nativeTranscript
		code := transcribe(model, &audio[0], uint64(len(audio)), 16000, 0, &result)
		runtime.KeepAlive(audio)
		if code != 0 {
			return "", fmt.Errorf("Moonshine transcription failed (%d)", code)
		}
		if result == nil || result.Count > 100000 || (result.Count > 0 && result.Lines == nil) {
			return "", fmt.Errorf("invalid Moonshine transcript")
		}
		var lines []string
		for _, line := range unsafe.Slice(result.Lines, int(result.Count)) {
			if line.Text == nil {
				continue
			}
			var text []byte
			for i := 0; i < 1<<20; i++ {
				c := *(*byte)(unsafe.Add(unsafe.Pointer(line.Text), i))
				if c == 0 {
					break
				}
				text = append(text, c)
			}
			if s := strings.TrimSpace(string(text)); s != "" {
				lines = append(lines, s)
			}
		}
		return strings.Join(lines, " "), nil
	}
	return run, func() { free(model) }, nil
}

// Layout from the pinned Moonshine v0.1.6 C header (64-bit platforms).
type nativeTranscript struct {
	Lines *nativeLine
	Count uint64
}
type nativeLine struct {
	Text            *byte
	Audio           uintptr
	AudioCount      uint64
	Start, Duration float32
	ID              uint64
	Flags           [5]int8
	Padding         [3]byte
	Speakers        uintptr
	SpeakerCount    uint64
	Latency         uint32
	Padding2        uint32
	Words           uintptr
	WordCount       uint64
}

func readPCM(path string) ([]float32, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return nil, fmt.Errorf("invalid WAV audio")
	}
	valid := false
	var pcm []byte
	for pos := 12; pos+8 <= len(data); {
		n := uint64(binary.LittleEndian.Uint32(data[pos+4:]))
		end := uint64(pos) + 8 + n
		if end > uint64(len(data)) {
			return nil, fmt.Errorf("truncated WAV audio")
		}
		chunk := data[pos+8 : int(end)]
		switch string(data[pos : pos+4]) {
		case "fmt ":
			valid = len(chunk) >= 16 && binary.LittleEndian.Uint16(chunk) == 1 && binary.LittleEndian.Uint16(chunk[2:]) == 1 && binary.LittleEndian.Uint32(chunk[4:]) == 16000 && binary.LittleEndian.Uint16(chunk[14:]) == 16
		case "data":
			pcm = chunk
		}
		pos = int(end) + (int(n) & 1)
	}
	if !valid || len(pcm) < 2 || len(pcm)%2 != 0 {
		return nil, fmt.Errorf("audio must be 16 kHz mono PCM16 WAV")
	}
	samples := make([]float32, len(pcm)/2)
	for i := range samples {
		samples[i] = float32(int16(binary.LittleEndian.Uint16(pcm[i*2:]))) / 32768
	}
	return samples, nil
}
