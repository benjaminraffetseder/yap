package speech

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unsafe"

	"yap/internal/audio"
)

func TestParakeetRejectsLegacyRuntime(t *testing.T) {
	dir := t.TempDir()
	name := "nemo-speech"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	legacy := filepath.Join(dir, "runtime", "nemo-speech-0.2.0", "bin", name)
	if err := os.MkdirAll(filepath.Dir(legacy), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("legacy runtime"), 0700); err != nil {
		t.Fatal(err)
	}
	opts := Options{Model: filepath.Join(dir, "models", "parakeet.q8_0.gguf")}
	if err := ValidateRuntimeFor(opts); err == nil {
		t.Fatal("accepted the legacy runtime that duplicates ASR weights")
	}
	current := RuntimeFor(opts)
	if err := os.MkdirAll(filepath.Dir(current), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(current, []byte("current runtime"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRuntimeFor(opts); err != nil {
		t.Fatal(err)
	}
}

func TestNativeTranscriptionMemoryError(t *testing.T) {
	cause := errors.New("exit status 0xc0000409")
	assertion := "ggml.c:1651: GGML_ASSERT(ctx->mem_buffer != NULL) failed"
	for _, tc := range []struct {
		name, kind, log string
		memory          bool
	}{
		{"allocation failure", "parakeet", assertion, true},
		{"long log", "parakeet", strings.Repeat("x", 3000) + assertion, true},
		{"unrelated assertion", "parakeet", "GGML_ASSERT(ne[0] > 0) failed", false},
		{"other engine", "moonshine", assertion, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := nativeTranscriptionError(tc.kind, cause, []byte(tc.log+" private transcript"))
			if !errors.Is(err, cause) || strings.Contains(err.Error(), "private transcript") {
				t.Fatalf("lost underlying error or exposed runtime output: %v", err)
			}
			if got := strings.Contains(err.Error(), "ran out of memory"); got != tc.memory {
				t.Fatalf("incorrect memory diagnosis: %v", err)
			}
			if tc.memory && !strings.Contains(err.Error(), "smaller speech model in Models") {
				t.Fatalf("missing recovery action: %v", err)
			}
		})
	}
}

func TestRuntimeRoutingKeepsWhisperSelection(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct{ model, kind string }{{"ggml-base.bin", "whisper"}, {"parakeet.q8_0.gguf", "parakeet"}, {"moonshine-v2-tiny", "moonshine"}} {
		opts := Options{Executable: "custom-whisper", Model: filepath.Join(dir, "models", tc.model)}
		if Kind(opts.Model) != tc.kind {
			t.Fatal("incorrect model kind", opts)
		}
		want := "custom-whisper"
		if tc.kind != "whisper" {
			want = RuntimePath(dir, tc.kind)
		}
		if got := RuntimeFor(opts); got != want {
			t.Fatalf("runtime: %s want %s", got, want)
		}
	}
}

func TestMoonshinePCMAndNativeLayout(t *testing.T) {
	if unsafe.Sizeof(nativeLine{}) != 88 || unsafe.Sizeof(nativeTranscript{}) != 16 {
		t.Fatal("native ABI layout changed")
	}
	var b bytes.Buffer
	audio.Header(&b, 4)
	binary.Write(&b, binary.LittleEndian, []int16{-32768, 16384})
	path := filepath.Join(t.TempDir(), "test.wav")
	os.WriteFile(path, b.Bytes(), 0600)
	pcm, err := readPCM(path)
	if err != nil || len(pcm) != 2 || pcm[0] != -1 || pcm[1] != .5 {
		t.Fatal("wrong PCM samples", pcm, err)
	}
	data := b.Bytes()
	binary.LittleEndian.PutUint32(data[24:], 48000)
	os.WriteFile(path, data, 0600)
	if _, err := readPCM(path); err == nil || err.Error() != "audio must be 16 kHz mono PCM16 WAV" {
		t.Fatal("expected an engine-neutral PCM error", err)
	}
}

func TestMoonshineLanguageAndIncompleteModel(t *testing.T) {
	dir := t.TempDir()
	model := filepath.Join(dir, "models", "moonshine-base")
	os.MkdirAll(model, 0700)
	b := Bundle{Arch: 1, Files: []BundleFile{{Name: "encoder.ort", Size: 7}}}
	data, _ := json.Marshal(b)
	os.WriteFile(filepath.Join(model, BundleManifest), data, 0600)
	if ValidateModel(model) == nil {
		t.Fatal("accepted incomplete bundle")
	}
	os.WriteFile(filepath.Join(model, "encoder.ort"), []byte("weights"), 0600)
	path := RuntimePath(dir, "moonshine")
	os.MkdirAll(filepath.Dir(path), 0700)
	os.WriteFile(path, []byte("runtime"), 0600)
	for _, language := range []string{"", "auto", "en"} {
		if err := Validate(Options{Model: model, Language: language}); err != nil {
			t.Fatalf("rejected supported Moonshine language %q: %v", language, err)
		}
	}
	if err := Validate(Options{Model: model, Language: "de"}); err == nil {
		t.Fatal("preflight accepted German for English-only model")
	}
	if _, err := (Local{}).Transcribe(context.Background(), "unused.wav", Options{Model: model, Language: "de"}); err == nil {
		t.Fatal("accepted German for English-only model")
	}
}
