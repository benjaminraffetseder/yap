package indicator

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// Geometry is separate from dictation settings, so saving a settings draft can
// never overwrite a position changed by dragging the native window.
func loadPosition(path string) (point, bool, error) {
	if path == "" {
		return point{}, false, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return point{}, false, nil
	}
	if err != nil {
		return point{}, false, err
	}
	var saved struct {
		X *int32 `json:"x"`
		Y *int32 `json:"y"`
	}
	if err := json.Unmarshal(data, &saved); err != nil {
		return point{}, false, err
	}
	if saved.X == nil || saved.Y == nil {
		return point{}, false, errors.New("indicator position is incomplete")
	}
	return point{X: *saved.X, Y: *saved.Y}, true, nil
}

func savePosition(path string, position point) error {
	if path == "" {
		return nil
	}
	data, err := json.Marshal(struct {
		X int32 `json:"x"`
		Y int32 `json:"y"`
	}{position.X, position.Y})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".indicator-position-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
