package storage

import (
	"archive/zip"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"os"
)

// Bound ZIP metadata before archive/zip allocates a File for every directory
// record. The same open handle is used for validation, preview and restore.
func openBackupZIP(ctx context.Context, path string) (*zip.Reader, *os.File, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	failed := true
	defer func() {
		if failed {
			file.Close()
		}
	}()
	info, err := file.Stat()
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxBackupBytes {
		return nil, nil, errors.New("choose a Yap backup smaller than 2 GiB")
	}
	reader := &backupZIPReaderAt{ctx: ctx, reader: file}
	if err := preflightBackupZIP(reader, info.Size()); err != nil {
		return nil, nil, err
	}
	zipped, err := zip.NewReader(reader, info.Size())
	if err != nil {
		return nil, nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	// Preview ends before restore begins. Later audio reads are cancelled by
	// backupReader with the restore context, not the finished preview context.
	reader.ctx = context.Background()
	failed = false
	return zipped, file, nil
}

type backupZIPReaderAt struct {
	ctx    context.Context
	reader io.ReaderAt
}

func (r *backupZIPReaderAt) ReadAt(data []byte, offset int64) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.ReadAt(data, offset)
}

func preflightBackupZIP(reader io.ReaderAt, size int64) error {
	invalid := errors.New("invalid Yap backup ZIP directory")
	if size < 22 {
		return invalid
	}
	// EOCD has a fixed 22-byte header followed by at most 65535 comment bytes.
	tailSize := min(size, int64(22+65535))
	tail := make([]byte, int(tailSize))
	if _, err := reader.ReadAt(tail, size-tailSize); err != nil {
		return err
	}
	endIndex := -1
	for i := len(tail) - 22; i >= 0; i-- {
		if binary.LittleEndian.Uint32(tail[i:i+4]) != 0x06054b50 {
			continue
		}
		// archive/zip selects the last signature even when it is embedded in
		// a comment. Do not skip it and validate a different directory.
		if i+22+int(binary.LittleEndian.Uint16(tail[i+20:i+22])) != len(tail) {
			return invalid
		}
		endIndex = i
		break
	}
	if endIndex < 0 {
		return invalid
	}
	end := tail[endIndex:]
	endPosition := size - tailSize + int64(endIndex)
	if binary.LittleEndian.Uint16(end[4:6]) != 0 || binary.LittleEndian.Uint16(end[6:8]) != 0 || binary.LittleEndian.Uint16(end[8:10]) != binary.LittleEndian.Uint16(end[10:12]) {
		return invalid // Multi-disk archives are not Yap backups.
	}
	count := uint64(binary.LittleEndian.Uint16(end[10:12]))
	directorySize := uint64(binary.LittleEndian.Uint32(end[12:16]))
	directoryOffset := uint64(binary.LittleEndian.Uint32(end[16:20]))
	if count == 0xffff || directorySize == 0xffffffff || directoryOffset == 0xffffffff {
		// Go's ZIP writer emits ZIP64 at 65535 files, which legitimate backups
		// can exceed. Read its fixed fields without trusting allocation sizes.
		if endPosition < 20 {
			return invalid
		}
		locator := make([]byte, 20)
		if _, err := reader.ReadAt(locator, endPosition-20); err != nil {
			return err
		}
		if binary.LittleEndian.Uint32(locator[:4]) != 0x07064b50 || binary.LittleEndian.Uint32(locator[4:8]) != 0 || binary.LittleEndian.Uint32(locator[16:20]) != 1 {
			return invalid
		}
		zip64Offset := binary.LittleEndian.Uint64(locator[8:16])
		if zip64Offset > uint64(endPosition-20) || uint64(endPosition-20)-zip64Offset < 56 {
			return invalid
		}
		zip64End := make([]byte, 56)
		if _, err := reader.ReadAt(zip64End, int64(zip64Offset)); err != nil {
			return err
		}
		recordSize := binary.LittleEndian.Uint64(zip64End[4:12])
		if binary.LittleEndian.Uint32(zip64End[:4]) != 0x06064b50 || recordSize < 44 || recordSize > uint64(maxManifestBytes) || recordSize+12 != uint64(endPosition-20)-zip64Offset || binary.LittleEndian.Uint32(zip64End[16:20]) != 0 || binary.LittleEndian.Uint32(zip64End[20:24]) != 0 || binary.LittleEndian.Uint64(zip64End[24:32]) != binary.LittleEndian.Uint64(zip64End[32:40]) {
			return invalid
		}
		count = binary.LittleEndian.Uint64(zip64End[32:40])
		directorySize = binary.LittleEndian.Uint64(zip64End[40:48])
		directoryOffset = binary.LittleEndian.Uint64(zip64End[48:56])
		endPosition = int64(zip64Offset)
	}
	if count > uint64(maxBackupEntries+1) {
		return errors.New("backup contains too many files")
	}
	if directorySize > uint64(maxManifestBytes) {
		return errors.New("backup ZIP metadata exceeds 64 MiB")
	}
	if directoryOffset > uint64(endPosition) || directorySize != uint64(endPosition)-directoryOffset {
		return invalid
	}
	// Count actual headers instead of trusting EOCD's record count: archive/zip
	// accepts classic counts modulo 65536 and otherwise reads until a bad header.
	var actual uint64
	position := int64(directoryOffset)
	header := make([]byte, 46)
	for position < endPosition {
		if endPosition-position < int64(len(header)) {
			return invalid
		}
		if _, err := reader.ReadAt(header, position); err != nil {
			return err
		}
		if binary.LittleEndian.Uint32(header[:4]) != 0x02014b50 {
			return invalid
		}
		actual++
		if actual > uint64(maxBackupEntries+1) {
			return errors.New("backup contains too many files")
		}
		recordSize := int64(46) + int64(binary.LittleEndian.Uint16(header[28:30])) + int64(binary.LittleEndian.Uint16(header[30:32])) + int64(binary.LittleEndian.Uint16(header[32:34]))
		if recordSize > endPosition-position {
			return invalid
		}
		position += recordSize
	}
	if actual != count {
		return invalid
	}
	return nil
}
