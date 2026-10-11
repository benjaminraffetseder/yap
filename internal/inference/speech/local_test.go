package speech

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"unsafe"

	"yap/internal/audio"
)

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
	if _, err := readPCM(path); err == nil {
		t.Fatal("accepted wrong sample rate")
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
	if _, err := (Local{}).Transcribe(context.Background(), "unused.wav", Options{Model: model, Language: "de"}); err == nil {
		t.Fatal("accepted German for English-only model")
	}
}
