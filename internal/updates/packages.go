package updates

import (
	"errors"
	"regexp"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

var packageVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
var packageRepository = regexp.MustCompile(`^[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$`)

func Supported(goos, goarch string) bool {
	return goos == "windows" && goarch == "amd64" ||
		(goos == "darwin" || goos == "linux") && (goarch == "amd64" || goarch == "arm64")
}

// AssetName keeps Linux packaging and release discovery on the same contract.
// Debian packages are installed by the package manager, never the Wails helper.
func AssetName(version, goos, goarch string) (string, error) {
	if !packageVersion.MatchString(version) {
		return "", errors.New("invalid package version")
	}
	if goos != "linux" || (goarch != "amd64" && goarch != "arm64") {
		return "", errors.New("Debian packages are unavailable for this system")
	}
	return "yap-" + version + "-linux-" + goarch + ".deb", nil
}

func packageDownloadURL(repository string, release *updater.Release, goos, goarch string) (string, error) {
	filename, err := AssetName(release.Version, goos, goarch)
	if err != nil {
		return "", err
	}
	tag, _ := release.Metadata["github.release.tag"].(string)
	if !packageRepository.MatchString(repository) || strings.HasSuffix(repository, "/.") || strings.HasSuffix(repository, "/..") ||
		release.Artifact.Filename != filename || (tag != release.Version && tag != "v"+release.Version) {
		return "", errors.New("invalid Debian update download")
	}
	return "https://github.com/" + repository + "/releases/download/" + tag + "/" + filename, nil
}
