package audio

import (
	"errors"
	"os"
)

// AVFoundation requires an absent output file. Remove only the empty regular
// file reserved by the caller; never replace existing audio or follow a link.
func removeEmptyCaptureReservation(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != 0 {
		return errors.New("microphone output is not an empty reserved recording file")
	}
	return os.Remove(path)
}
