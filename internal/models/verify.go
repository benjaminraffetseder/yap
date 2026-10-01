package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"sync"
)

var verification = struct {
	sync.Mutex
	files map[string]verifiedFile
}{files: map[string]verifiedFile{}}

type verifiedFile struct {
	info  os.FileInfo
	sha   string
	valid bool
}

func sameVersion(a, b os.FileInfo) bool {
	return os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}

// Snapshots reuse verification only for the same file identity/size/mtime and
// expected hash. Installation always hashes again, including after a failed run.
func verifyModel(ctx context.Context, path string, model Model, cached bool) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() || info.Size() != model.Size {
		return false, nil
	}
	if cached {
		verification.Lock()
		old, found := verification.files[path]
		verification.Unlock()
		if found && old.sha == model.SHA && sameVersion(old.info, info) {
			return old.valid, nil
		}
	}
	h := sha256.New()
	buffer := make([]byte, 128*1024)
	for {
		if err = ctx.Err(); err != nil {
			return false, err
		}
		n, readErr := f.Read(buffer)
		h.Write(buffer[:n])
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return false, readErr
		}
	}
	end, err := f.Stat()
	if err != nil {
		return false, err
	}
	if !sameVersion(info, end) {
		return false, fmt.Errorf("model changed while checking it; try again")
	}
	if err = ctx.Err(); err != nil {
		return false, err
	}
	valid := hex.EncodeToString(h.Sum(nil)) == model.SHA
	verification.Lock()
	if len(verification.files) >= 32 {
		clear(verification.files)
	}
	verification.files[path] = verifiedFile{info: end, sha: model.SHA, valid: valid}
	verification.Unlock()
	return valid, nil
}
