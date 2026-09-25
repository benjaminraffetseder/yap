package audio

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

func TestPCMHeaderAndLevel(t *testing.T) {
	var b bytes.Buffer
	if err := Header(&b, 32000); err != nil {
		t.Fatal(err)
	}
	v := b.Bytes()
	if len(v) != 44 || string(v[:4]) != "RIFF" || string(v[8:12]) != "WAVE" || binary.LittleEndian.Uint32(v[4:]) != 32036 || binary.LittleEndian.Uint32(v[24:]) != 16000 || binary.LittleEndian.Uint16(v[34:]) != 16 || binary.LittleEndian.Uint32(v[40:]) != 32000 {
		t.Fatal("incorrect 16kHz mono PCM WAV header")
	}
	if Level(make([]byte, 8)) != 0 {
		t.Fatal("silence is not zero")
	}
	if math.IsNaN(Level(nil)) {
		t.Fatal("empty buffer returned NaN")
	}
	if Level([]byte{0xff, 0x7f}) < .99 {
		t.Fatal("full scale input is not represented")
	}
}
