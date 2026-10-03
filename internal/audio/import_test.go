package audio

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func importFixture(t *testing.T, codec, bits, channels uint16, rate uint32, seconds int) string {
	t.Helper()
	align := channels * bits / 8
	size := int(rate) * int(align) * seconds
	data := make([]byte, 44+size)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], codec)
	binary.LittleEndian.PutUint16(data[22:], channels)
	binary.LittleEndian.PutUint32(data[24:], rate)
	binary.LittleEndian.PutUint32(data[28:], rate*uint32(align))
	binary.LittleEndian.PutUint16(data[32:], align)
	binary.LittleEndian.PutUint16(data[34:], bits)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(size))
	for i := 44; i < len(data); i += int(bits / 8) {
		if codec == 3 {
			binary.LittleEndian.PutUint32(data[i:], math.Float32bits(.25))
			continue
		}
		switch bits {
		case 8:
			data[i] = 160
		case 16:
			binary.LittleEndian.PutUint16(data[i:], 8192)
		case 24:
			data[i+2] = 32
		case 32:
			binary.LittleEndian.PutUint32(data[i:], 0x20000000)
		}
	}
	path := filepath.Join(t.TempDir(), "source.wav")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestImportNormalizesPCMAndFloatWithoutChangingSource(t *testing.T) {
	for _, format := range []struct {
		codec, bits, channels uint16
		rate                  uint32
	}{{1, 8, 1, 8000}, {1, 16, 1, 16000}, {1, 16, 2, 44100}, {1, 24, 2, 48000}, {1, 32, 1, 96000}, {3, 32, 2, 48000}} {
		path := importFixture(t, format.codec, format.bits, format.channels, format.rate, 1)
		before, _ := os.ReadFile(path)
		var normalized bytes.Buffer
		duration, err := NormalizeFile(context.Background(), path, &normalized)
		if err != nil || duration != 1000 {
			t.Fatalf("%+v: %d %v", format, duration, err)
		}
		got := normalized.Bytes()
		if len(got) != 32044 || binary.LittleEndian.Uint32(got[24:]) != 16000 || binary.LittleEndian.Uint16(got[22:]) != 1 {
			t.Fatalf("bad normalized format: %+v", format)
		}
		for i := 44; i < len(got); i += 2 {
			if binary.LittleEndian.Uint16(got[i:]) != 8192 {
				t.Fatalf("sample changed: %+v at %d", format, i)
			}
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(before, after) {
			t.Fatal("source changed")
		}
	}
}

func importToneFixture(t *testing.T, rate uint32, frequency float64) string {
	t.Helper()
	path := importFixture(t, 1, 16, 1, rate, 1)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for frame := 0; frame < int(rate); frame++ {
		value := int16(math.Round(.4 * 32768 * math.Sin(2*math.Pi*frequency*float64(frame)/float64(rate))))
		binary.LittleEndian.PutUint16(data[44+frame*2:], uint16(value))
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestImportDownsamplingPreservesSpeechBandAndRejectsAliases(t *testing.T) {
	for _, rate := range []uint32{44100, 48000, 96000, 192000} {
		for _, frequency := range []float64{1000, 12000} {
			t.Run(fmt.Sprintf("%dHz/%gHz", rate, frequency), func(t *testing.T) {
				path := importToneFixture(t, rate, frequency)
				var output bytes.Buffer
				if duration, err := NormalizeFile(context.Background(), path, &output); err != nil || duration != 1000 {
					t.Fatalf("conversion failed: %d %v", duration, err)
				}
				data := output.Bytes()
				if len(data) != 32044 {
					t.Fatalf("wrong duration: %d bytes", len(data))
				}
				var energy float64
				// Ignore boundary transients from padding the first/last sample.
				const start, end = 256, 16000 - 256
				for frame := start; frame < end; frame++ {
					value := float64(int16(binary.LittleEndian.Uint16(data[44+frame*2:]))) / 32768
					energy += value * value
				}
				rms := math.Sqrt(energy / (end - start))
				if frequency == 1000 {
					if math.Abs(rms-.4/math.Sqrt2) > .003 {
						t.Fatalf("speech-band signal changed: RMS %g", rms)
					}
				} else if rms > .001 {
					t.Fatalf("12 kHz aliased into output: RMS %g", rms)
				}
			})
		}
	}
}

func TestImportNativeRatePreservesPCMSamplesExactly(t *testing.T) {
	path := importToneFixture(t, 16000, 1703)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if _, err := NormalizeFile(context.Background(), path, &output); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before[44:], output.Bytes()[44:]) {
		t.Fatal("16 kHz PCM changed")
	}
}

type cancelResampleWriter struct {
	bytes.Buffer
	cancel context.CancelFunc
	writes int
}

func (w *cancelResampleWriter) Write(data []byte) (int, error) {
	n, err := w.Buffer.Write(data)
	w.writes++
	if w.writes == 2 { // Header, then the first converted PCM block.
		w.cancel()
	}
	return n, err
}

func TestImportCancellationDuringFilteredDownsampling(t *testing.T) {
	path := importToneFixture(t, 44100, 1000)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	output := &cancelResampleWriter{cancel: cancel}
	if _, err := NormalizeFile(ctx, path, output); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation ignored: %v", err)
	}
	if output.Len() != 44+8192 {
		t.Fatalf("continued after cancellation: %d bytes", output.Len())
	}
}

func TestImportRejectsInvalidAndOversizedAudio(t *testing.T) {
	path := importFixture(t, 1, 16, 1, 16000, 1)
	valid, _ := os.ReadFile(path)
	for _, change := range []func([]byte){
		func(b []byte) { copy(b, "ID3 ") },
		func(b []byte) { binary.LittleEndian.PutUint16(b[20:], 6) },
		func(b []byte) { binary.LittleEndian.PutUint16(b[22:], 3) },
		func(b []byte) { binary.LittleEndian.PutUint32(b[40:], uint32(len(b))) },
		func(b []byte) { binary.LittleEndian.PutUint16(b[32:], 0) },
		func(b []byte) { binary.LittleEndian.PutUint32(b[24:], 1) },
	} {
		bad := bytes.Clone(valid)
		change(bad)
		os.WriteFile(path, bad, 0600)
		var output bytes.Buffer
		if _, err := NormalizeFile(context.Background(), path, &output); err == nil {
			t.Fatal("accepted malformed or unsupported WAV")
		}
		if output.Len() != 0 {
			t.Fatal("wrote before format validation")
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Truncate(maxImportBytes + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if _, err := NormalizeFile(context.Background(), path, &bytes.Buffer{}); err == nil {
		t.Fatal("accepted oversized file")
	}
	// A sparse valid WAV over ten minutes must fail before conversion starts.
	long := bytes.Clone(valid[:44])
	size := uint32(16000 * 2 * 601)
	binary.LittleEndian.PutUint32(long[4:], size+36)
	binary.LittleEndian.PutUint32(long[40:], size)
	f, _ = os.Create(path)
	f.Write(long)
	f.Truncate(int64(size) + 44)
	f.Close()
	if _, err := NormalizeFile(context.Background(), path, &bytes.Buffer{}); err == nil {
		t.Fatal("accepted overlong WAV")
	}
}

type cancelImportWriter struct {
	bytes.Buffer
	cancel context.CancelFunc
}

func (w *cancelImportWriter) Write(data []byte) (int, error) {
	n, err := w.Buffer.Write(data)
	w.cancel()
	return n, err
}

func TestImportCancellationAndInvalidFloat(t *testing.T) {
	path := importFixture(t, 3, 32, 1, 16000, 1)
	ctx, cancel := context.WithCancel(context.Background())
	w := &cancelImportWriter{cancel: cancel}
	if _, err := NormalizeFile(ctx, path, w); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel ignored: %v", err)
	}
	data, _ := os.ReadFile(path)
	binary.LittleEndian.PutUint32(data[44:], math.Float32bits(float32(math.NaN())))
	os.WriteFile(path, data, 0600)
	if _, err := NormalizeFile(context.Background(), path, &bytes.Buffer{}); err == nil {
		t.Fatal("accepted invalid float")
	}
}
