package imports

import (
	"context"
	"errors"
	"os"
	"time"

	"yap/internal/audio"
	"yap/internal/models"
)

// Execution freezes one job's decoder and approved installer. Hooks bridge only
// progress/phase changes; decoding never accesses application state.
type Execution struct {
	source, decoder string
	install         Installer
}

type DecodeHooks struct {
	DownloadProgress func(int64, int64)
	Decoding         func()
}

func (e Execution) Downloading() bool { return e.install != nil }

// Decode returns the same import deadline for transcription. The caller owns
// canceling it after transcription and registering its worker before unlocking.
// The recording file is closed for every outcome, including install failure.
func (e Execution) Decode(ctx context.Context, dir string, file *os.File, hooks DecodeHooks) (importCtx context.Context, stop context.CancelFunc, duration int64, err error) {
	decoder := e.decoder
	if e.install != nil {
		downloadCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
		decoder, err = e.install(downloadCtx, dir, hooks.DownloadProgress)
		cancel()
	}
	importCtx, stop = context.WithTimeout(ctx, 15*time.Minute)
	if err == nil {
		err = importCtx.Err()
	}
	if err == nil {
		if hooks.Decoding != nil {
			hooks.Decoding()
		}
		if decoder == "" {
			decoder = models.FFmpegPath(dir)
		}
		duration, err = audio.NormalizeImportWithFFmpeg(importCtx, e.source, file, decoder)
	}
	err = errors.Join(err, file.Close())
	return
}
