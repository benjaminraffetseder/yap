package startup

import (
	"bufio"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"yap/internal/desktopentry"
	"yap/internal/fileutil"
)

const loginDesktopFile = "com.yap.desktop.desktop"

type linuxStartup struct {
	path, executable string
	systemPaths      []string
}

func New() (Controller, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	config := os.Getenv("XDG_CONFIG_HOME")
	if !filepath.IsAbs(config) {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		config = filepath.Join(home, ".config")
	}
	s := &linuxStartup{path: filepath.Join(config, "autostart", loginDesktopFile), executable: executable}
	dirs := os.Getenv("XDG_CONFIG_DIRS")
	if dirs == "" {
		dirs = "/etc/xdg"
	}
	for _, dir := range filepath.SplitList(dirs) {
		if filepath.IsAbs(dir) {
			s.systemPaths = append(s.systemPaths, filepath.Join(dir, "autostart", loginDesktopFile))
		}
	}
	return s, nil
}

func (s *linuxStartup) Enabled() (bool, error) {
	for _, path := range append([]string{s.path}, s.systemPaths...) {
		file, err := os.Open(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return false, err
		}
		values := map[string]string{}
		scanner := bufio.NewScanner(file)
		inEntry := false
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if strings.HasPrefix(line, "[") {
				inEntry = line == "[Desktop Entry]"
			} else if key, value, found := strings.Cut(line, "="); inEntry && found {
				values[strings.TrimSpace(key)] = strings.TrimSpace(value)
			}
		}
		err = scanner.Err()
		file.Close()
		if err != nil {
			return false, err
		}
		if values["Hidden"] == "true" || values["X-GNOME-Autostart-enabled"] == "false" || values["Type"] != "Application" || values["Exec"] == "" {
			return false, nil
		}
		current := strings.Split(os.Getenv("XDG_CURRENT_DESKTOP"), ":")
		matches := func(value string) bool {
			for _, desktop := range strings.Split(value, ";") {
				if desktop != "" && slices.Contains(current, desktop) {
					return true
				}
			}
			return false
		}
		if only := values["OnlyShowIn"]; only != "" && !matches(only) || matches(values["NotShowIn"]) {
			return false, nil
		}
		if program := values["TryExec"]; program != "" {
			if _, err := exec.LookPath(program); err != nil {
				return false, nil
			}
		}
		return true, nil
	}
	return false, nil
}

func (s *linuxStartup) SetEnabled(enabled bool) error {
	if !enabled {
		hasSystemEntry := false
		for _, path := range s.systemPaths {
			if _, err := os.Stat(path); err == nil {
				hasSystemEntry = true
			} else if !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
		if !hasSystemEntry {
			err := os.Remove(s.path)
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	data := "[Desktop Entry]\nType=Application\nName=Yap\nExec=" + desktopentry.QuoteExec(s.executable) + "\nIcon=com.yap.desktop\nTerminal=false\n"
	if !enabled {
		// Mask an administrator-provided entry instead of exposing it by deletion.
		data += "Hidden=true\n"
	}
	return fileutil.WriteAtomic(s.path, []byte(data))
}
