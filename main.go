package main

import (
	"embed"
	"fmt"
	"log"
	"os"

	"yap/internal/app"
	"yap/internal/inference/speech"
	"yap/internal/platform"

	"gopkg.in/yaml.v3"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

// Use the same version for update checks and native executable metadata.
//
//go:embed build/config.yml
var appBuildConfig []byte

// A separate public release repository can be selected with -ldflags "-X main.updateRepository=owner/repo".
var updateRepository = "benjaminraffetseder/yap"

func appVersion() string {
	var config struct {
		Info struct {
			Version string `yaml:"version"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal(appBuildConfig, &config); err != nil {
		panic(err)
	}
	return config.Info.Version
}

func main() {
	if handled, err := speech.RunWorker(os.Args[1:]); handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := platform.PrepareDesktopEntry(); err != nil {
		log.Printf("prepare desktop launcher: %v", err)
	}
	if err := app.Run(app.Options{
		Assets:           assets,
		Icon:             appIcon,
		Version:          appVersion(),
		UpdateRepository: updateRepository,
	}); err != nil {
		log.Fatal(err)
	}
}
