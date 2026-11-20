package main

import (
	"encoding/json"
	"encoding/xml"
	"io"
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestUpdateVersionMatchesBuildMetadata(t *testing.T) {
	data, err := os.ReadFile("build/config.yml")
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Info struct {
			Version string `yaml:"version"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if appVersion() == "" || appVersion() != config.Info.Version {
		t.Fatalf("update version %q differs from native metadata %q", appVersion(), config.Info.Version)
	}
	nativeData, err := os.ReadFile("build/windows/info.json")
	if err != nil {
		t.Fatal(err)
	}
	var native struct {
		Fixed struct {
			Version string `json:"file_version"`
		} `json:"fixed"`
		Info map[string]struct{ FileVersion, ProductVersion string }
	}
	if err := json.Unmarshal(nativeData, &native); err != nil {
		t.Fatal(err)
	}
	if native.Fixed.Version != appVersion() {
		t.Fatal("Windows version metadata differs from build/config.yml")
	}
	if native.Info["0409"].FileVersion != appVersion() || native.Info["0409"].ProductVersion != appVersion() {
		t.Fatal("Windows string version metadata differs from build/config.yml")
	}
	for _, path := range []string{"build/darwin/Info.plist", "build/darwin/Info.dev.plist", "build/windows/wails.exe.manifest"} {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "{{") {
			t.Fatalf("%s still contains v2 template syntax", path)
		}
		decoder := xml.NewDecoder(strings.NewReader(string(data)))
		for {
			_, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("%s: %v", path, err)
			}
		}
		if !strings.Contains(string(data), appVersion()) || !strings.Contains(string(data), "com.yap.desktop") {
			t.Fatalf("%s lost the application version or identity", path)
		}
		if strings.HasSuffix(path, ".plist") && !strings.Contains(string(data), "NSMicrophoneUsageDescription") {
			t.Fatalf("%s lost the microphone permission description", path)
		}
	}
}
