package platform

import (
	"os"
	"path/filepath"
	"strings"

	"yap/internal/desktopentry"
	"yap/internal/fileutil"
)

// PrepareDesktopEntry runs before single-instance handoff and shortcut setup so
// an old hidden portal helper cannot hide a newly installed launcher.
func PrepareDesktopEntry() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	return ensurePortalDesktopEntry(executable)
}

// Host portal registration requires a discoverable desktop entry, including
// for an unpackaged development build. Keep installed entries intact and hide
// this identity-only entry from launchers.
func ensurePortalDesktopEntry(executable string) error {
	dataHome := os.Getenv("XDG_DATA_HOME")
	if !filepath.IsAbs(dataHome) {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		dataHome = filepath.Join(home, ".local", "share")
	}
	dataDirs := os.Getenv("XDG_DATA_DIRS")
	if dataDirs == "" {
		dataDirs = "/usr/local/share:/usr/share"
	}
	const filename = "com.yap.desktop.desktop"
	userEntry := filepath.Join(dataHome, "applications", filename)
	// An installed launcher must supersede only our hidden identity helper.
	// A manually customized per-user launcher remains the user's override.
	for _, dir := range filepath.SplitList(dataDirs) {
		if !filepath.IsAbs(dir) || dir == dataHome {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, "applications", filename)); err == nil {
			return removePortalDesktopHelper(userEntry)
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	if _, err := os.Stat(userEntry); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	dir := filepath.Join(dataHome, "applications")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	execValue := desktopentry.QuoteExec(executable)
	entry := "[Desktop Entry]\nType=Application\nName=Yap\nComment=Local dictation for your desktop\nExec=" + execValue + "\nIcon=audio-input-microphone\nTerminal=false\nNoDisplay=true\nX-Yap-PortalIdentity=true\n"
	return fileutil.WriteAtomic(filepath.Join(dir, filename), []byte(entry))
}

func removePortalDesktopHelper(path string) error {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	entry := string(data)
	legacy := strings.HasPrefix(entry, "[Desktop Entry]\nType=Application\nName=Yap\nComment=Local dictation for your desktop\nExec=") && strings.HasSuffix(entry, "\nIcon=audio-input-microphone\nTerminal=false\nNoDisplay=true\n")
	if legacy || strings.Contains(entry, "\nX-Yap-PortalIdentity=true\n") {
		return os.Remove(path)
	}
	return nil
}
