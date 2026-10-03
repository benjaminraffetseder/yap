package storage

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testZIPFile(t *testing.T, entries int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "backup.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for i := 0; i < entries; i++ {
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: fmt.Sprintf("audio/%064x.wav", i), Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if _, err := entry.Write([]byte("recording")); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestBackupZIPOrdinaryAndZIP64(t *testing.T) {
	for _, entries := range []int{1, 65535} {
		t.Run(fmt.Sprint(entries), func(t *testing.T) {
			path := testZIPFile(t, entries)
			ctx, cancel := context.WithCancel(context.Background())
			reader, file, err := openBackupZIP(ctx, path)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			cancel() // Finishing preview must not disable subsequent restore reads.
			if len(reader.File) != entries {
				t.Fatalf("lost entries: %d", len(reader.File))
			}
			entry, err := reader.File[0].Open()
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(entry)
			entry.Close()
			if err != nil || string(data) != "recording" {
				t.Fatalf("archive unusable after preview: %q %v", data, err)
			}
		})
	}
}

func testZIPDirectoryEnd(count uint16, size uint32) []byte {
	end := make([]byte, 22)
	binary.LittleEndian.PutUint32(end[:4], 0x06054b50)
	binary.LittleEndian.PutUint16(end[8:10], count)
	binary.LittleEndian.PutUint16(end[10:12], count)
	binary.LittleEndian.PutUint32(end[12:16], size)
	return end
}

func TestBackupZIPRejectsActualEntryCountDespiteUnderstatedEOCD(t *testing.T) {
	const count = maxBackupEntries + 2
	header := make([]byte, 46)
	binary.LittleEndian.PutUint32(header[:4], 0x02014b50)
	data := bytes.Repeat(header, count)
	// archive/zip accepts directory counts modulo 65536. This crafted classic
	// count understates the real count while satisfying that comparison.
	data = append(data, testZIPDirectoryEnd(uint16(count%65536), uint32(len(data)))...)
	path := filepath.Join(t.TempDir(), "excessive.zip")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if reader, file, err := openBackupZIP(context.Background(), path); err == nil {
		file.Close()
		t.Fatalf("accepted %d directory entries", len(reader.File))
	} else if !strings.Contains(err.Error(), "too many files") {
		t.Fatal(err)
	}
}

func TestBackupZIPRejectsOversizedDirectoryAndMalformedBounds(t *testing.T) {
	path := filepath.Join(t.TempDir(), "metadata.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	// Sparse metadata avoids allocating 64 MiB just to prove the limit.
	directorySize := maxManifestBytes + 1
	if _, err := file.WriteAt(testZIPDirectoryEnd(1, uint32(directorySize)), directorySize); err != nil {
		t.Fatal(err)
	}
	file.Close()
	if _, file, err := openBackupZIP(context.Background(), path); err == nil {
		file.Close()
		t.Fatal("accepted oversized directory")
	} else if !strings.Contains(err.Error(), "metadata exceeds") {
		t.Fatal(err)
	}
	for _, end := range [][]byte{
		testZIPDirectoryEnd(1, 0),      // Missing claimed record.
		testZIPDirectoryEnd(0, 1),      // Directory overlaps its end marker.
		testZIPDirectoryEnd(0xffff, 0), // Missing required ZIP64 locator.
	} {
		if err := preflightBackupZIP(bytes.NewReader(end), int64(len(end))); err == nil {
			t.Fatal("accepted malformed ZIP directory")
		}
	}
}

func TestBackupZIPRejectsAmbiguousEmbeddedDirectoryEnd(t *testing.T) {
	for _, embeddedCommentLength := range []uint16{0, 2} {
		// The outer comment reaches EOF exactly, but the inner EOCD either
		// leaves trailing data or claims a truncated comment. Go chooses that
		// last signature; preflight must not fall back to the outer one.
		outer := testZIPDirectoryEnd(0, 0)
		binary.LittleEndian.PutUint16(outer[20:22], 23)
		inner := testZIPDirectoryEnd(0, 0)
		binary.LittleEndian.PutUint16(inner[20:22], embeddedCommentLength)
		data := append(append(outer, inner...), 0)
		if err := preflightBackupZIP(bytes.NewReader(data), int64(len(data))); err == nil {
			t.Fatal("validated a different end marker from archive/zip")
		}
	}
}

type cancellingZIPReader struct {
	reader io.ReaderAt
	cancel context.CancelFunc
}

func (r cancellingZIPReader) ReadAt(data []byte, offset int64) (int, error) {
	n, err := r.reader.ReadAt(data, offset)
	r.cancel()
	return n, err
}

func TestBackupZIPCancellationBeforeAndDuringDirectory(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := openBackupZIP(ctx, "not-opened.zip"); !errors.Is(err, context.Canceled) {
		t.Fatalf("ignored cancellation before opening: %v", err)
	}
	path := testZIPFile(t, 2)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel = context.WithCancel(context.Background())
	reader := &backupZIPReaderAt{ctx: ctx, reader: cancellingZIPReader{bytes.NewReader(data), cancel}}
	if err := preflightBackupZIP(reader, int64(len(data))); !errors.Is(err, context.Canceled) {
		t.Fatalf("ignored cancellation during directory scan: %v", err)
	}
}
