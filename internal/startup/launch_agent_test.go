package startup

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestLaunchAgentRegistration(t *testing.T) {
	s := &launchAgent{path: filepath.Join(t.TempDir(), "LaunchAgents", "com.yap.desktop.login.plist"), executable: `/Applications/Names & "quotes" <test>/Yap.app/Contents/MacOS/Yap`}
	if enabled, err := s.Enabled(); enabled || err != nil {
		t.Fatalf("missing agent: %v, %v", enabled, err)
	}
	if err := s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	for _, executable := range []string{s.executable, "/Applications/New Location/Yap.app/Contents/MacOS/Yap"} {
		s.executable = executable
		if err := s.SetEnabled(true); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(s.path)
		if err != nil {
			t.Fatal(err)
		}
		var plist struct {
			XMLName xml.Name `xml:"plist"`
			Dict    struct {
				Keys      []string  `xml:"key"`
				Strings   []string  `xml:"string"`
				Arguments []string  `xml:"array>string"`
				RunAtLoad *struct{} `xml:"true"`
			} `xml:"dict"`
		}
		if err := xml.Unmarshal(data, &plist); err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(plist.Dict.Arguments, []string{executable}) || plist.Dict.RunAtLoad == nil || !slices.Contains(plist.Dict.Keys, "RunAtLoad") || slices.Contains(plist.Dict.Keys, "KeepAlive") || !slices.Contains(plist.Dict.Strings, "com.yap.desktop.login") || !slices.Contains(plist.Dict.Strings, "Aqua") {
			t.Fatalf("invalid login job: %s", data)
		}
		if enabled, err := s.Enabled(); !enabled || err != nil {
			t.Fatalf("agent not enabled: %v", err)
		}
	}
	other := filepath.Join(filepath.Dir(s.path), "another-app.plist")
	if err := os.WriteFile(other, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if enabled, err := s.Enabled(); enabled || err != nil {
		t.Fatalf("agent not removed: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Fatal("removed another app's login job")
	}
}

func TestLaunchAgentFailedWriteLeavesNoPartialFiles(t *testing.T) {
	s := &launchAgent{path: filepath.Join(t.TempDir(), "blocked.plist"), executable: "/Applications/Yap.app/Contents/MacOS/Yap"}
	if err := os.Mkdir(s.path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEnabled(true); err == nil {
		t.Fatal("replaced a directory with a login job")
	}
	files, err := os.ReadDir(filepath.Dir(s.path))
	if err != nil || len(files) != 1 || !files[0].IsDir() {
		t.Fatalf("partial login files remain: %v, %v", files, err)
	}
}
