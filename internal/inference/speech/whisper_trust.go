package speech

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

type whisperPair struct {
	cli, server       string // installed paths relative to the version directory
	cliSHA, serverSHA string
}

// Executable SHA-256 values from the b5454 archives pinned by models.whisperRuntimes.
// The installer strips the top-level directory of the Linux tarballs only.
func pinnedWhisperPair(platform string) (whisperPair, bool) {
	switch platform {
	case "windows/amd64":
		return whisperPair{"Release/whisper-cli.exe", "Release/whisper-server.exe",
			"331dba46d6427105d2b802cdbc7eae916ea1c5abf9b0d3b5cfe460d8db8e4366",
			"a97456e747f28e7bb09c1dac35f40d94404c5ecffa74aaaaa7a3753ea6543121"}, true
	case "linux/amd64":
		return whisperPair{"whisper-cli", "whisper-server",
			"110a858e128d1fbc5a75899b42a1de8a7a4c10856bfe45dad1adc278f6459d14",
			"864cae691ad3eea424152d4d86f17bc22d6d39b0d0c5a91577038178eb8a1659"}, true
	case "linux/arm64":
		return whisperPair{"whisper-cli", "whisper-server",
			"83efce4e4e61c014045b2166422cb60a0a234764cad6a260fe8137fa562bd1db",
			"1830e2943b1c8ae0fa4def8cc7d52a80d844670f6606bd53a8d77aa5c5d31e78"}, true
	}
	return whisperPair{}, false
}

// serverPath selects a candidate. A new process also requires matchesDigests.
func (pair whisperPair) serverPath(dir, selected string) string {
	if pair.cli == "" || dir == "" || !filepath.IsAbs(selected) {
		return ""
	}
	root := filepath.Join(dir, "runtime", "whisper-"+WhisperRuntimeVersion)
	cli, server := filepath.Join(root, pair.cli), filepath.Join(root, pair.server)
	if filepath.FromSlash(selected) != cli {
		return ""
	}
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return ""
	}
	for _, path := range []string{cli, server} {
		actual, err := filepath.EvalSymlinks(path)
		if err != nil {
			return ""
		}
		part, err := filepath.Rel(dir, path)
		if err != nil {
			return ""
		}
		if rel, err := filepath.Rel(filepath.Join(realDir, part), actual); err != nil || rel != "." {
			return ""
		}
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 || (runtime.GOOS != "windows" && info.Mode().Perm()&0111 == 0) {
			return ""
		}
	}
	return server
}

func (pair whisperPair) matchesDigests(cli, server string) bool {
	return matchesWhisperDigest(cli, pair.cliSHA) && matchesWhisperDigest(server, pair.serverSHA)
}

func matchesWhisperDigest(path, digest string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil || !before.Mode().IsRegular() {
		return false
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil || hex.EncodeToString(h.Sum(nil)) != digest {
		return false
	}
	after, err := os.Lstat(path)
	return err == nil && os.SameFile(before, after) && before.Size() == after.Size() && before.ModTime().Equal(after.ModTime())
}
