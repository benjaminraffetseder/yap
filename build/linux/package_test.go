package main

import (
	"debug/elf"
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The desktop's real theme lookup catches invalid icon directories that pass
// desktop-file-validate. This test builds/extracts a package without installing it.
func TestLinuxPackageDesktopIntegration(t *testing.T) {
	if os.Getenv("YAP_PACKAGE_INTEGRATION") != "1" {
		t.Skip("set YAP_PACKAGE_INTEGRATION=1 after building the production binary")
	}
	const python = "/usr/bin/python3"
	if output, err := exec.Command(python, "-c", "import gi; gi.require_version('Gtk', '4.0'); from gi.repository import Gtk").CombinedOutput(); err != nil {
		t.Fatalf("package integration needs Python GI and GTK 4: %v: %s", err, output)
	}
	t.Chdir("../..")
	work := t.TempDir()
	archive, err := packageLinux("build/bin/yap", work)
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(work, "extracted")
	if output, err := exec.Command("dpkg-deb", "--extract", archive, root).CombinedOutput(); err != nil {
		t.Fatalf("extract Linux package: %v: %s", err, output)
	}
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	t.Setenv("XDG_DATA_DIRS", filepath.Join(root, "usr/share")+":/usr/share")
	t.Setenv("YAP_PACKAGE_TEST_ROOT", root)
	command := exec.Command(python, "-c", `
import os
from pathlib import Path
import gi
gi.require_version("Gtk", "4.0")
gi.require_version("GioUnix", "2.0")
from gi.repository import Gtk, GioUnix
root = Path(os.environ["YAP_PACKAGE_TEST_ROOT"])
app = GioUnix.DesktopAppInfo.new("com.yap.desktop.desktop")
assert app and app.should_show(), "Yap is hidden from application search"
assert Path(app.get_filename()) == root / "usr/share/applications/com.yap.desktop.desktop"
assert app.get_executable() == "/usr/bin/yap"
theme = Gtk.IconTheme.new()
theme.set_search_path([str(root / "usr/share/icons"), "/usr/share/icons"])
theme.set_theme_name("hicolor")
assert theme.has_icon("com.yap.desktop"), "Yap's packaged icon is not discoverable by GTK"
icon = theme.lookup_icon("com.yap.desktop", None, 64, 1, Gtk.TextDirection.NONE, Gtk.IconLookupFlags(0))
assert icon and icon.get_file(), "Yap's icon cannot be loaded"
assert Path(icon.get_file().get_path()).is_relative_to(root), "GTK resolved an icon outside the package"
print("Packaged Yap is visible in application search and its icon resolves through GTK.")
`)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("desktop lookup: %v: %s", err, output)
	}
	t.Log(string(output))
}

func TestPackageArchitectureUsesExecutableInsteadOfHost(t *testing.T) {
	for _, test := range []struct {
		machine elf.Machine
		want    string
	}{{elf.EM_X86_64, "amd64"}, {elf.EM_AARCH64, "arm64"}, {elf.EM_386, ""}} {
		// Minimal ELF64 header; the target is read from the binary, never runtime.GOARCH.
		data := make([]byte, 64)
		copy(data, "\x7fELF")
		data[4], data[5], data[6] = 2, 1, 1
		binary.LittleEndian.PutUint16(data[16:], uint16(elf.ET_EXEC))
		binary.LittleEndian.PutUint16(data[18:], uint16(test.machine))
		binary.LittleEndian.PutUint32(data[20:], 1)
		binary.LittleEndian.PutUint16(data[52:], 64)
		path := filepath.Join(t.TempDir(), "yap")
		if err := os.WriteFile(path, data, 0755); err != nil {
			t.Fatal(err)
		}
		arch, err := binaryArchitecture(path)
		if test.want == "" && err == nil || test.want != "" && (err != nil || arch != test.want) {
			t.Fatalf("machine %v: architecture=%q error=%v", test.machine, arch, err)
		}
	}
}
