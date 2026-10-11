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

// Moonshine runs in an isolated child process. Cancellation terminates native
// inference, and a native failure cannot take down the desktop application.
func RunWorker(args []string) (handled bool, err error) {
	if len(args) == 0 || (args[0] != "--yap-moonshine-worker" && args[0] != "--yap-moonshine-check") {
		return false, nil
	}
	handled = true
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("Moonshine runtime: %v", p)
		}
	}()
	if len(args) < 2 {
		return true, fmt.Errorf("missing Moonshine runtime")
	}
	h, closeLibrary, err := openMoonshine(args[1])
	if err != nil {
		return true, err
	}
	defer closeLibrary()
	var version func() int32
	purego.RegisterLibFunc(&version, h, "moonshine_get_version")
	if version() != 30000 {
		return true, fmt.Errorf("unsupported Moonshine runtime version")
	}
	if args[0] == "--yap-moonshine-check" {
		return true, nil
	}
	if len(args) != 6 {
		return true, fmt.Errorf("invalid Moonshine worker arguments")
	}
	bundle, err := ReadBundle(args[2])
	if err != nil {
		return true, err
	}
	audio, err := readPCM(args[3])
	if err != nil {
		return true, err
	}
	var load func(string, uint32, uintptr, uint64, int32) int32
	var free func(int32)
	var transcribe func(int32, *float32, uint64, int32, uint32, **nativeTranscript) int32
	purego.RegisterLibFunc(&load, h, "moonshine_load_transcriber_from_files")
	purego.RegisterLibFunc(&free, h, "moonshine_free_transcriber")
	purego.RegisterLibFunc(&transcribe, h, "moonshine_transcribe_without_streaming")
	model := load(args[2], bundle.Arch, 0, 0, 30000)
	if model < 0 {
		return true, fmt.Errorf("Moonshine could not load model (%d)", model)
	}
	defer free(model)
	if bundle.Arch != 1 && args[5] != "" {
		var keyterms func(int32, string) int32
		purego.RegisterLibFunc(&keyterms, h, "moonshine_transcriber_set_keyterms")
		if code := keyterms(model, args[5]); code != 0 {
			return true, fmt.Errorf("Moonshine vocabulary failed (%d)", code)
		}
	}
	var result *nativeTranscript
	code := transcribe(model, &audio[0], uint64(len(audio)), 16000, 0, &result)
	runtime.KeepAlive(audio)
	if code != 0 {
		return true, fmt.Errorf("Moonshine transcription failed (%d)", code)
	}
	if result == nil || result.Count > 100000 || (result.Count > 0 && result.Lines == nil) {
		return true, fmt.Errorf("invalid Moonshine transcript")
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
	return true, os.WriteFile(args[4], []byte(strings.Join(lines, " ")), 0600)
}

// Layout from the pinned Moonshine v0.1.5 C header (64-bit platforms).
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
		return nil, fmt.Errorf("Moonshine needs 16 kHz mono PCM16 WAV audio")
	}
	samples := make([]float32, len(pcm)/2)
	for i := range samples {
		samples[i] = float32(int16(binary.LittleEndian.Uint16(pcm[i*2:]))) / 32768
	}
	return samples, nil
}
