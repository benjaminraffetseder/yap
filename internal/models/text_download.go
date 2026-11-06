package models

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

const textChunkSize int64 = 64 << 20

// Keep completed chunks across cancellation/network failures. Only a complete
// file matching the catalog checksum is published as an installed model.
func downloadTextModel(ctx context.Context, dir string, m TextModel, report func(int64, int64)) error {
	root, err := managedModelDirectory(dir)
	if err != nil {
		return err
	}
	dest := filepath.Join(root, m.Filename)
	if _, err := os.Lstat(dest); err == nil {
		if err := managedModelPath(dir, dest); err != nil {
			return err
		}
		valid, err := verifyModel(ctx, dest, Model{Size: m.Size, SHA: m.SHA}, false)
		if err != nil {
			return err
		}
		if valid {
			report(m.Size, m.Size)
			return nil
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	parts := filepath.Join(root, ".text-download-"+m.ID)
	if err := os.MkdirAll(parts, 0700); err != nil {
		return err
	}
	validate := func() error {
		actual, err := managedModelDirectory(dir)
		if err != nil {
			return err
		}
		resolved, err := filepath.EvalSymlinks(parts)
		if err != nil {
			return err
		}
		if !samePath(actual, root) || !samePath(resolved, parts) {
			return errors.New("text download storage is redirected; repair it manually")
		}
		return nil
	}
	if err := validate(); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var next, completed atomic.Int64
	count := (m.Size + textChunkSize - 1) / textChunkSize
	var workers sync.WaitGroup
	var first error
	var errorMu, reportMu sync.Mutex
	client := &http.Client{Timeout: 5 * time.Minute}
	for range min(int64(4), count) {
		workers.Go(func() {
			for {
				index := next.Add(1) - 1
				if index >= count || ctx.Err() != nil {
					return
				}
				start, end := index*textChunkSize, min((index+1)*textChunkSize, m.Size)-1
				chunk := filepath.Join(parts, fmt.Sprintf("%06d", index))
				err := downloadTextChunk(ctx, client, m.URL, chunk, start, end, m.Size, validate)
				if err != nil {
					errorMu.Lock()
					if first == nil {
						first = err
					}
					errorMu.Unlock()
					cancel()
					return
				}
				completed.Add(end - start + 1)
				reportMu.Lock()
				report(completed.Load(), m.Size)
				reportMu.Unlock()
			}
		})
	}
	workers.Wait()
	if first != nil {
		return first
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate(); err != nil {
		return err
	}
	out, err := os.CreateTemp(root, ".text-assemble-")
	if err != nil {
		return err
	}
	defer os.Remove(out.Name())
	h, digest := newDigest(m.SHA)
	for index := int64(0); index < count; index++ {
		if err = ctx.Err(); err != nil {
			break
		}
		path := filepath.Join(parts, fmt.Sprintf("%06d", index))
		if info, e := os.Lstat(path); e != nil || !info.Mode().IsRegular() {
			err = errors.New("invalid text download chunk")
			break
		}
		var src *os.File
		src, err = os.Open(path)
		if err != nil {
			break
		}
		length := min((index+1)*textChunkSize, m.Size) - index*textChunkSize
		var n int64
		n, err = io.Copy(io.MultiWriter(out, h), io.LimitReader(src, length+1))
		src.Close()
		if err == nil && n != length {
			err = errors.New("text download chunk changed during verification; retry the download")
		}
		if err != nil {
			break
		}
	}
	closeErr := out.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if digest() != m.SHA {
		if validate() == nil {
			_ = os.RemoveAll(parts)
		}
		return errors.New("text model checksum mismatch; retry the download")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate(); err != nil {
		return err
	}
	if _, err := os.Lstat(dest); err == nil {
		if err := managedModelPath(dir, dest); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(out.Name(), dest); err != nil {
		return err
	}
	if validate() == nil {
		_ = os.RemoveAll(parts)
	}
	return nil
}

func downloadTextChunk(ctx context.Context, client *http.Client, url, dest string, start, end, total int64, validate func() error) error {
	if err := validate(); err != nil {
		return err
	}
	if info, err := os.Lstat(dest); err == nil {
		if !info.Mode().IsRegular() {
			return errors.New("invalid text download chunk")
		}
		if info.Size() == end-start+1 {
			return nil
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	req.Header.Set("User-Agent", "Yap/0.1")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || resp.Header.Get("Content-Range") != fmt.Sprintf("bytes %d-%d/%d", start, end, total) {
		return fmt.Errorf("text model download returned an invalid byte range (HTTP %d); retry the download", resp.StatusCode)
	}
	if err := validate(); err != nil {
		return err
	}
	out, err := os.CreateTemp(filepath.Dir(dest), ".chunk-")
	if err != nil {
		return err
	}
	defer os.Remove(out.Name())
	n, err := io.Copy(out, io.LimitReader(resp.Body, end-start+2))
	closeErr := out.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if n != end-start+1 {
		return errors.New("text model download chunk has the wrong size; retry the download")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate(); err != nil {
		return err
	}
	return os.Rename(out.Name(), dest)
}
