package audio

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
)

const maxImportBytes int64 = 256 << 20
const maxImportSeconds int64 = 25 * 60

type importWaveFormat struct {
	codec, channels, bits, align uint16
	rate                         uint32
	offset, size                 int64
}

// NormalizeFile reads a bounded local WAV and writes Whisper's 16 kHz mono PCM.
// Only the destination is written; source audio is never retained or modified.
func NormalizeFile(ctx context.Context, path string, destination io.Writer) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxImportBytes {
		return 0, errors.New("choose a WAV file smaller than 256 MiB")
	}
	format, err := readWave(ctx, f, info.Size())
	if err != nil {
		return 0, err
	}
	frames := format.size / int64(format.align)
	if frames < int64(format.rate)*3/10 || frames > int64(format.rate)*maxImportSeconds {
		return 0, errImportDuration
	}
	if _, err = f.Seek(format.offset, io.SeekStart); err != nil {
		return 0, err
	}
	count := frames * 16000 / int64(format.rate)
	if err = Header(destination, uint32(count*2)); err != nil {
		return 0, err
	}
	frame := make([]byte, format.align)
	reader := bufio.NewReaderSize(f, 64*1024)
	read := func() (float64, error) {
		if _, err := io.ReadFull(reader, frame); err != nil {
			return 0, err
		}
		var sum float64
		for channel := 0; channel < int(format.channels); channel++ {
			data := frame[channel*int(format.bits/8):]
			var value float64
			if format.codec == 3 {
				value = float64(math.Float32frombits(binary.LittleEndian.Uint32(data)))
			} else {
				switch format.bits {
				case 8:
					value = float64(int(data[0])-128) / 128
				case 16:
					value = float64(int16(binary.LittleEndian.Uint16(data))) / 32768
				case 24:
					value = float64(int32(uint32(data[0])|uint32(data[1])<<8|uint32(data[2])<<16)<<8) / 2147483648
				case 32:
					value = float64(int32(binary.LittleEndian.Uint32(data))) / 2147483648
				}
			}
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return 0, errors.New("WAV contains invalid audio samples")
			}
			sum += value
		}
		return sum / float64(format.channels), nil
	}
	var sample func(int64) (float64, error)
	if format.rate > 16000 {
		resampler, err := newImportResampler(ctx, format.rate, frames, read)
		if err != nil {
			return 0, err
		}
		sample = resampler.sample
	} else {
		previous, err := read()
		if err != nil {
			return 0, err
		}
		next, err := read()
		if err != nil {
			return 0, err
		}
		index := int64(0)
		sample = func(i int64) (float64, error) {
			position := i * int64(format.rate)
			target := position / 16000
			for index < target {
				previous = next
				index++
				if index+1 < frames {
					next, err = read()
					if err != nil {
						return 0, err
					}
				} else {
					next = previous
				}
			}
			return previous + (next-previous)*float64(position%16000)/16000, nil
		}
	}
	buffer := make([]byte, 8192)
	used := 0
	for i := int64(0); i < count; i++ {
		if used == 0 {
			if err := ctx.Err(); err != nil {
				return 0, err
			}
		}
		value, err := sample(i)
		if err != nil {
			return 0, err
		}
		pcm := int16(math.Max(-32768, math.Min(32767, math.Round(value*32768))))
		binary.LittleEndian.PutUint16(buffer[used:], uint16(pcm))
		used += 2
		if used == len(buffer) || i+1 == count {
			if _, err := destination.Write(buffer[:used]); err != nil {
				return 0, err
			}
			used = 0
		}
	}
	return frames * 1000 / int64(format.rate), ctx.Err()
}

// A Blackman-windowed sinc removes frequencies above the output Nyquist limit
// before decimation. Precomputed phases avoid trigonometry in the sample loop.
// At the maximum input rate this uses 385 taps and at most 1025 phase tables
// (about 3 MiB), independently of the recording length. Common rates use their
// exact rational phases: one at 48/96/192 kHz, and 160 at 44.1 kHz.
type importResampler struct {
	rate, frames, loaded int64
	half, width, phases  int
	weights              [][]float64
	ring                 []float64
	first, last          float64
	read                 func() (float64, error)
}

func newImportResampler(ctx context.Context, rate uint32, frames int64, read func() (float64, error)) (*importResampler, error) {
	a, b := int(rate), 16000
	for b != 0 {
		a, b = b, a%b
	}
	phases := min(16000/a, 1024)
	ratio := float64(rate) / 16000
	half := int(math.Ceil(16 * ratio))
	r := &importResampler{rate: int64(rate), frames: frames, half: half, width: 2*half + 1, phases: phases, read: read}
	r.ring = make([]float64, 2*r.width)
	r.weights = make([][]float64, phases+1)
	cutoff := .45 / ratio // 7.2 kHz leaves a transition band below 8 kHz.
	for phase := range r.weights {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		weights := make([]float64, r.width)
		fraction, total := float64(phase)/float64(phases), 0.0
		for tap := range weights {
			distance := float64(tap-half) - fraction
			if math.Abs(distance) > float64(half) {
				continue
			}
			window := .42 + .5*math.Cos(math.Pi*distance/float64(half)) + .08*math.Cos(2*math.Pi*distance/float64(half))
			weight := 2 * cutoff
			if distance != 0 {
				weight = math.Sin(2*math.Pi*cutoff*distance) / (math.Pi * distance)
			}
			weights[tap] = weight * window
			total += weights[tap]
		}
		for tap := range weights {
			weights[tap] /= total // Preserve DC, including constant edge padding.
		}
		r.weights[phase] = weights
	}
	return r, nil
}

func (r *importResampler) sample(output int64) (float64, error) {
	position := output * r.rate
	center := position / 16000
	phase := int((position%16000*int64(r.phases) + 8000) / 16000)
	weights := r.weights[phase]
	start, end := max(int64(0), center-int64(r.half)), min(r.frames, center+int64(r.half)+1)
	for r.loaded < end {
		value, err := r.read()
		if err != nil {
			return 0, err
		}
		if r.loaded == 0 {
			r.first = value
		}
		r.last = value
		index := int(r.loaded % int64(r.width))
		// Duplicating the ring lets each convolution read contiguous samples.
		r.ring[index], r.ring[index+r.width] = value, value
		r.loaded++
	}
	left := int(start - (center - int64(r.half)))
	count := int(end - start)
	index := int(start % int64(r.width))
	samples := r.ring[index : index+count]
	var value float64
	for _, weight := range weights[:left] {
		value += r.first * weight
	}
	for tap, sample := range samples {
		value += sample * weights[left+tap]
	}
	for _, weight := range weights[left+count:] {
		value += r.last * weight
	}
	return value, nil
}

func readWave(ctx context.Context, f *os.File, size int64) (importWaveFormat, error) {
	var out importWaveFormat
	invalid := errors.New("choose an uncompressed mono or stereo WAV (PCM 8/16/24/32-bit or float32)")
	header := make([]byte, 12)
	if _, err := io.ReadFull(f, header); err != nil {
		return out, invalid
	}
	if string(header[:4]) != "RIFF" || string(header[8:]) != "WAVE" {
		return out, invalid
	}
	end := int64(binary.LittleEndian.Uint32(header[4:8])) + 8
	if end > size || end < 12 {
		return out, errors.New("WAV file is truncated or damaged")
	}
	foundFormat, foundData := false, false
	for position := int64(12); position < end; {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if end-position < 8 {
			return out, invalid
		}
		if _, err := f.Seek(position, io.SeekStart); err != nil {
			return out, err
		}
		chunk := make([]byte, 8)
		if _, err := io.ReadFull(f, chunk); err != nil {
			return out, err
		}
		length := int64(binary.LittleEndian.Uint32(chunk[4:]))
		data := position + 8
		if length > end-data {
			return out, errors.New("WAV file is truncated or damaged")
		}
		switch string(chunk[:4]) {
		case "fmt ":
			if foundFormat || length < 16 || length > 4096 {
				return out, invalid
			}
			format := make([]byte, length)
			if _, err := io.ReadFull(f, format); err != nil {
				return out, err
			}
			out.codec, out.channels = binary.LittleEndian.Uint16(format), binary.LittleEndian.Uint16(format[2:])
			out.rate, out.align, out.bits = binary.LittleEndian.Uint32(format[4:]), binary.LittleEndian.Uint16(format[12:]), binary.LittleEndian.Uint16(format[14:])
			if out.codec == 0xfffe {
				guidTail := []byte{0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71}
				if len(format) < 40 || binary.LittleEndian.Uint16(format[16:]) < 22 || binary.LittleEndian.Uint16(format[18:]) != out.bits || string(format[26:40]) != string(guidTail) {
					return out, invalid
				}
				out.codec = binary.LittleEndian.Uint16(format[24:])
			}
			if (out.channels != 1 && out.channels != 2) || out.rate < 8000 || out.rate > 192000 || (out.codec != 1 && out.codec != 3) || (out.codec == 1 && out.bits != 8 && out.bits != 16 && out.bits != 24 && out.bits != 32) || (out.codec == 3 && out.bits != 32) || out.align != out.channels*(out.bits/8) || binary.LittleEndian.Uint32(format[8:]) != out.rate*uint32(out.align) {
				return out, invalid
			}
			foundFormat = true
		case "data":
			if foundData {
				return out, invalid
			}
			out.offset, out.size, foundData = data, length, true
		}
		position = data + length + (length % 2)
		if position > end {
			return out, invalid
		}
	}
	if !foundFormat || !foundData || out.size == 0 || out.size%int64(out.align) != 0 {
		return out, fmt.Errorf("WAV is missing valid audio data")
	}
	return out, nil
}
