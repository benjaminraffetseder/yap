package audio

import (
	"encoding/binary"
	"io"
	"math"
	"os"
)

type Capture interface {
	Start(path, microphoneID string, level func(float64)) error
	Stop() (int64, error)
}

// An empty microphone ID selects the system default. IDs identify devices, not
// enumeration positions, so reconnecting another input cannot change the choice.
type Device struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func Header(w io.Writer, n uint32) error {
	b := make([]byte, 44)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], n+36)
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 16000)
	binary.LittleEndian.PutUint32(b[28:], 32000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], n)
	_, err := w.Write(b)
	return err
}
func finish(f *os.File, n uint32) error {
	if _, err := f.Seek(0, 0); err != nil {
		f.Close()
		return err
	}
	err := Header(f, n)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func Level(data []byte) float64 {
	if len(data) < 2 {
		return 0
	}
	var sum float64
	for i := 0; i+1 < len(data); i += 2 {
		v := float64(int16(binary.LittleEndian.Uint16(data[i:]))) / 32768
		sum += v * v
	}
	return math.Min(1, math.Sqrt(sum/float64(len(data)/2))*5)
}
