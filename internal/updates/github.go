package updates

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

func NewGitHub(repository string) (updater.Provider, error) {
	return newGitHub(github.Config{Repository: repository})
}

func newGitHub(cfg github.Config) (updater.Provider, error) {
	cfg.ChecksumAsset = "SHA256SUMS"
	cfg.AssetMatcher = matchAsset
	provider, err := github.New(cfg)
	if err != nil {
		return nil, err
	}
	return verifiedGitHub{provider}, nil
}

type verifiedGitHub struct{ updater.Provider }

func (p verifiedGitHub) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	release, err := p.Provider.Check(ctx, req)
	if err != nil || release == nil {
		return release, err
	}
	name := strings.ToLower(release.Artifact.Filename)
	prefix := "yap-" + release.Version
	validName := req.Platform == "windows" && name == prefix+"-windows-"+req.Arch+".exe"
	if req.Platform == "darwin" {
		validName = name == prefix+"-macos-"+req.Arch+".zip" || name == prefix+"-macos-universal.zip"
	}
	if !validName {
		return nil, errors.New("the update asset filename does not match the release version")
	}
	// Wails' GitHub provider treats a missing sidecar/entry as optional. Yap
	// requires a complete SHA-256 digest before offering an executable update.
	v := release.Verification
	if v == nil || v.DigestAlgo != "sha256" || len(v.Digest) != sha256.Size {
		return nil, errors.New("the update is missing a valid SHA256SUMS entry; try again after the release is complete")
	}
	return release, nil
}

func matchAsset(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	suffixes := []string{}
	switch req.Platform {
	case "windows":
		if req.Arch == "amd64" {
			// A setup.exe is an installer, not the running Yap executable.
			suffixes = append(suffixes, "-windows-amd64.exe")
		}
	case "darwin":
		if req.Arch == "amd64" || req.Arch == "arm64" {
			// Prefer the architecture-specific bundle over a universal bundle.
			suffixes = append(suffixes, "-macos-"+req.Arch+".zip", "-macos-universal.zip")
		}
	}
	for _, suffix := range suffixes {
		for i, asset := range assets {
			name := strings.ToLower(asset.Name)
			if strings.HasPrefix(name, "yap-") && strings.HasSuffix(name, suffix) && asset.Size > 0 {
				return i
			}
		}
	}
	return -1
}
