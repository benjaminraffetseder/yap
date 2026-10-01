package audio

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestDrainPreservesQueueOrderAcrossWrapAndReset(t *testing.T) {
	f, err := os.Create(filepath.Join(t.TempDir(), "pcm"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r := &Recorder{file: f, buffers: [][]byte{{1, 0}, {2, 0}, {3, 0}, {4, 0}}}
	for range r.buffers {
		r.headers = append(r.headers, &waveHeader{BufferLength: 2})
	}
	// First three buffers complete, then return to the end of the driver queue.
	for i := 0; i < 3; i++ {
		r.headers[i].Flags, r.headers[i].BytesRecorded = 1, 2
	}
	r.drain(func(h *waveHeader) error { h.Flags, h.BytesRecorded = 0, 0; return nil }, func(float64) {})
	// A delayed poll/reset returns oldest h3 plus newer h0 and partial h1.
	r.buffers[0] = []byte{5, 0}
	r.buffers[1] = []byte{6, 0, 99, 0}
	r.headers[1].BufferLength = 4
	r.headers[3].Flags, r.headers[3].BytesRecorded = 1, 2
	r.headers[0].Flags, r.headers[0].BytesRecorded = 1, 2
	r.headers[1].Flags, r.headers[1].BytesRecorded = 1, 2
	r.headers[2].Flags, r.headers[2].BytesRecorded = 1, 0
	r.drain(nil, func(float64) {})
	if r.err != nil {
		t.Fatal(r.err)
	}
	got, err := os.ReadFile(f.Name())
	if err != nil || !bytes.Equal(got, []byte{1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0}) {
		t.Fatalf("audio reordered: %v %v", got, err)
	}
}

func TestDrainWaitsForOldestBufferAndDoesNotRepeatRequeuedData(t *testing.T) {
	f, err := os.Create(filepath.Join(t.TempDir(), "pcm"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r := &Recorder{file: f, buffers: [][]byte{{1, 0}, {2, 0}}, headers: []*waveHeader{{}, {Flags: 1, BytesRecorded: 2}}}
	queue := func(h *waveHeader) error { h.Flags, h.BytesRecorded = 0, 0; return nil }
	r.drain(queue, func(float64) {})
	if r.count != 0 {
		t.Fatal("wrote a later buffer before the oldest")
	}
	r.headers[0].Flags, r.headers[0].BytesRecorded = 1, 2
	r.drain(queue, func(float64) {})
	r.drain(queue, func(float64) {})
	got, _ := os.ReadFile(f.Name())
	if !bytes.Equal(got, []byte{1, 0, 2, 0}) {
		t.Fatalf("duplicated/reordered data: %v", got)
	}
}
