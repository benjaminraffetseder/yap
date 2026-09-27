package startup

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"unicode/utf16"

	"golang.org/x/sys/windows/registry"
)

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

type windowsStartup struct {
	key, command string
}

func New() (Controller, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	command := `"` + executable + `"`
	// Run values have a documented 260-character command-line limit.
	if strings.ContainsAny(executable, "\"\r\n") || len(utf16.Encode([]rune(command))) > 260 {
		return nil, errors.New("move Yap to a shorter path to enable launch at login")
	}
	return &windowsStartup{key: runKey, command: command}, nil
}

func (s *windowsStartup) Enabled() (bool, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, s.key, registry.QUERY_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer key.Close()
	value, _, err := key.GetStringValue("Yap")
	if errors.Is(err, registry.ErrNotExist) {
		return false, nil
	}
	return value != "", err
}

func (s *windowsStartup) SetEnabled(enabled bool) error {
	if enabled {
		key, _, err := registry.CreateKey(registry.CURRENT_USER, s.key, registry.SET_VALUE)
		if err != nil {
			return fmt.Errorf("register Yap at login: %w", err)
		}
		defer key.Close()
		return key.SetStringValue("Yap", s.command)
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, s.key, registry.SET_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer key.Close()
	err = key.DeleteValue("Yap")
	if errors.Is(err, registry.ErrNotExist) {
		return nil
	}
	return err
}
