// The Linux release task runs this tool after building the production binary.
package main

import (
	"debug/buildinfo"
	"debug/elf"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"yap/internal/updates"

	"gopkg.in/yaml.v3"
)

func main() {
	binary := flag.String("binary", "build/bin/yap", "built Linux executable")
	output := flag.String("output", "build/bin", "package output directory")
	flag.Parse()
	path, err := packageLinux(*binary, *output)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(path)
}

func packageLinux(binary, output string) (string, error) {
	for _, tool := range []string{"dpkg-shlibdeps", "dpkg-deb", "desktop-file-validate"} {
		if _, err := exec.LookPath(tool); err != nil {
			return "", fmt.Errorf("Linux packaging needs dpkg-dev and desktop-file-utils: %w", err)
		}
	}
	binary, err := filepath.Abs(binary)
	if err != nil {
		return "", err
	}
	arch, err := binaryArchitecture(binary)
	if err != nil {
		return "", err
	}
	if info, err := buildinfo.ReadFile(binary); err == nil {
		for _, setting := range info.Settings {
			if setting.Key == "-tags" && slices.Contains(strings.Split(setting.Value, ","), "dev") {
				return "", fmt.Errorf("build Yap without the dev tag before packaging")
			}
		}
	}
	var config struct {
		Info struct {
			Version string `yaml:"version"`
		} `yaml:"info"`
	}
	data, err := os.ReadFile("build/config.yml")
	if err != nil {
		return "", err
	}
	if err := yaml.Unmarshal(data, &config); err != nil {
		return "", err
	}
	filename, err := updates.AssetName(config.Info.Version, "linux", arch)
	if err != nil {
		return "", err
	}
	work, err := os.MkdirTemp("", "yap-deb-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(work)
	root := filepath.Join(work, "package")
	files := []struct {
		source, destination string
		mode                os.FileMode
	}{
		{binary, "usr/bin/yap", 0755},
		{"build/linux/com.yap.desktop.desktop", "usr/share/applications/com.yap.desktop.desktop", 0644},
		{"frontend/src/assets/app-icon.svg", "usr/share/icons/hicolor/scalable/apps/com.yap.desktop.svg", 0644},
		{"LICENSE", "usr/share/doc/yap/copyright", 0644},
	}
	for _, file := range files {
		if err := copyPackageFile(file.source, filepath.Join(root, file.destination), file.mode); err != nil {
			return "", err
		}
	}
	if output, err := exec.Command("desktop-file-validate", filepath.Join(root, "usr/share/applications/com.yap.desktop.desktop")).CombinedOutput(); err != nil {
		return "", fmt.Errorf("validate Linux launcher: %w: %s", err, output)
	}
	// Resolve ABI requirements from this exact binary, including GTK3/GTK4 and
	// the build host's glibc. Do not advertise compatibility with older libraries.
	debian := filepath.Join(work, "debian")
	if err := os.Mkdir(debian, 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(debian, "control"), []byte("Source: yap\nSection: sound\nPriority: optional\nMaintainer: Benjamin Raffetseder <benjamin.raffetseder1@gmail.com>\n\nPackage: yap\nArchitecture: any\nDescription: Local dictation for your desktop\n"), 0644); err != nil {
		return "", err
	}
	command := exec.Command("dpkg-shlibdeps", "-O", "-e"+filepath.Join(root, "usr/bin/yap"))
	command.Dir = work
	resolved, err := command.Output()
	if err != nil {
		if failed, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("resolve native Linux dependencies: %w: %s", err, failed.Stderr)
		}
		return "", err
	}
	dependencies := ""
	for _, line := range strings.Split(string(resolved), "\n") {
		if value, ok := strings.CutPrefix(line, "shlibs:Depends="); ok {
			dependencies = value
		}
	}
	if dependencies == "" {
		return "", fmt.Errorf("dpkg-shlibdeps returned no native dependencies")
	}
	dependencies += ", ffmpeg, pulseaudio-utils, xdotool, xwayland, at-spi2-core, xdg-desktop-portal"
	control := fmt.Sprintf("Package: yap\nVersion: %s\nArchitecture: %s\nSection: sound\nPriority: optional\nMaintainer: Benjamin Raffetseder <benjamin.raffetseder1@gmail.com>\nHomepage: https://github.com/benjaminraffetseder/yap\nDepends: %s\nRecommends: pipewire-pulse | pulseaudio\nDescription: Local dictation for your desktop\n Hold a shortcut, speak, and release to paste a locally transcribed result.\n Supports local speech and text models, history, and audio-file imports.\n", config.Info.Version, arch, dependencies)
	if err := os.Mkdir(filepath.Join(root, "DEBIAN"), 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(root, "DEBIAN/control"), []byte(control), 0644); err != nil {
		return "", err
	}
	if err := os.MkdirAll(output, 0755); err != nil {
		return "", err
	}
	path, err := filepath.Abs(filepath.Join(output, filename))
	if err != nil {
		return "", err
	}
	if result, err := exec.Command("dpkg-deb", "--root-owner-group", "--build", root, path).CombinedOutput(); err != nil {
		return "", fmt.Errorf("build Linux package: %w: %s", err, result)
	}
	return path, nil
}

func binaryArchitecture(path string) (string, error) {
	binary, err := elf.Open(path)
	if err != nil {
		return "", err
	}
	defer binary.Close()
	if binary.Class != elf.ELFCLASS64 || binary.Data != elf.ELFDATA2LSB {
		return "", fmt.Errorf("Linux packages require a 64-bit little-endian executable")
	}
	switch binary.Machine {
	case elf.EM_X86_64:
		return "amd64", nil
	case elf.EM_AARCH64:
		return "arm64", nil
	default:
		return "", fmt.Errorf("unsupported Linux executable architecture: %v", binary.Machine)
	}
}

func copyPackageFile(source, destination string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
