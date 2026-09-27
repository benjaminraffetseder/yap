package startup

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func New() (Controller, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	macOS := filepath.Dir(executable)
	contents := filepath.Dir(macOS)
	if filepath.Base(macOS) != "MacOS" || filepath.Base(contents) != "Contents" || !strings.HasSuffix(filepath.Dir(contents), ".app") {
		return nil, errors.New("launch at login requires the packaged Yap.app")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return &launchAgent{path: filepath.Join(home, "Library", "LaunchAgents", "com.yap.desktop.login.plist"), executable: executable}, nil
}
