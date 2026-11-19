package updates

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

func TestLinuxPackagesUseWailsDiscoveryWithoutExecutableInstallation(t *testing.T) {
	for _, arch := range []string{"amd64", "arm64"} {
		for _, mode := range []string{"valid", "missing checksum", "wrong version"} {
			t.Run(arch+"/"+mode, func(t *testing.T) {
				filename, err := AssetName("0.12.0", "linux", arch)
				if err != nil {
					t.Fatal(err)
				}
				var server *httptest.Server
				server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch r.URL.Path {
					case "/repos/owner/yap/releases/latest":
						name := filename
						if mode == "wrong version" {
							name = "yap-0.11.0-linux-" + arch + ".deb"
						}
						assets := []map[string]any{
							{"name": "yap-0.12.0-windows-amd64.exe", "size": 1, "url": server.URL + "/wrong-artifact"},
							{"name": "yap-0.12.0-linux-386.deb", "size": 1, "url": server.URL + "/wrong-artifact"},
							{"name": name, "size": 1, "url": server.URL + "/artifact"},
						}
						if mode != "missing checksum" {
							assets = append(assets, map[string]any{"name": "SHA256SUMS", "url": server.URL + "/checksums"})
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v0.12.0", "assets": assets})
					case "/checksums":
						_, _ = fmt.Fprintf(w, "%x  %s\n", sha256.Sum256([]byte("package")), filename)
					default:
						t.Errorf("a metadata check downloaded a package: %s", r.URL.Path)
						w.WriteHeader(http.StatusNotFound)
					}
				}))
				defer server.Close()
				provider, err := newGitHub(github.Config{Repository: "owner/yap", BaseURL: server.URL, HTTPClient: server.Client()})
				if err != nil {
					t.Fatal(err)
				}
				engine := updater.New(testHost{})
				if err := engine.Init(updater.Config{CurrentVersion: "0.11.0", Providers: []updater.Provider{provider}, Platform: "linux", Arch: arch, Window: updater.WindowNone}); err != nil {
					t.Fatal(err)
				}
				checker := NewForPlatform("0.11.0", "owner/yap", filepath.Join(t.TempDir(), "updates.json"), engine, "linux", arch)
				s := checker.Check(context.Background(), true)
				if mode != "valid" {
					if s.Available || s.Error == "" || s.DownloadURL != "" {
						t.Fatalf("incomplete release offered: %+v", s)
					}
					return
				}
				if !s.ManualInstall || !s.Available || s.Error != "" || s.DownloadURL != "https://github.com/owner/yap/releases/download/v0.12.0/"+filename {
					t.Fatalf("incorrect Debian download: %+v", s)
				}
				if checker.Install(context.Background()) == nil || checker.Restart(context.Background()) == nil || engine.State() != updater.StateAvailable {
					t.Fatal("Debian package entered the native executable installation path")
				}
			})
		}
	}
}

func TestLinuxCacheRemainsScopedToPlatformAndArchitecture(t *testing.T) {
	path := filepath.Join(t.TempDir(), "updates.json")
	engine := &fakeEngine{release: &updater.Release{Version: "0.12.0", Artifact: updater.Artifact{Filename: "yap-0.12.0-linux-amd64.deb"}, Metadata: map[string]any{"github.release.tag": "v0.12.0"}}}
	checker := NewForPlatform("0.11.0", "owner/yap", path, engine, "linux", "amd64")
	if !checker.Check(context.Background(), true).Available {
		t.Fatal("Linux update unavailable")
	}
	if !NewForPlatform("0.11.0", "owner/yap", path, engine, "linux", "amd64").Status().Available {
		t.Fatal("Linux display cache was not restored")
	}
	for _, target := range [][2]string{{"windows", "amd64"}, {"linux", "arm64"}} {
		if NewForPlatform("0.11.0", "owner/yap", path, engine, target[0], target[1]).Status().Available {
			t.Fatal("package cache crossed platforms", target)
		}
	}
	checker = NewForPlatform("0.11.0", "owner/yap", path, engine, "linux", "386")
	calls := engine.calls
	if checker.Check(context.Background(), true).Supported || engine.calls != calls {
		t.Fatal("unsupported architecture checked for updates")
	}
}

func TestPackageDownloadURLRejectsUntrustedReleasePaths(t *testing.T) {
	for _, tag := range []string{"0.12.0", "v0.12.0", "v0.12.0/../../other"} {
		for _, repository := range []string{"owner/yap", "owner/..", "owner/yap?token=secret"} {
			release := &updater.Release{Version: "0.12.0", Artifact: updater.Artifact{Filename: "yap-0.12.0-linux-amd64.deb"}, Metadata: map[string]any{"github.release.tag": tag}}
			url, err := packageDownloadURL(repository, release, "linux", "amd64")
			valid := repository == "owner/yap" && (tag == "0.12.0" || tag == "v0.12.0")
			if valid {
				if err != nil || url != "https://github.com/owner/yap/releases/download/"+tag+"/yap-0.12.0-linux-amd64.deb" {
					t.Fatalf("incorrect package URL: %q, %v", url, err)
				}
			} else if err == nil || url != "" {
				t.Fatal("untrusted release path accepted", tag, repository)
			}
		}
	}
}
