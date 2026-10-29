# Wails build files

These are source inputs to `wails3 dev` and `wails3 build`, not generated output.

- `appicon.png` is the source app icon and the Wails system tray icon.
- `windows/icon.ico` is the Windows executable icon.
- `windows/info.json` supplies executable version metadata alongside `build/config.yml`.
- `windows/wails.exe.manifest` configures Windows common controls and DPI support.
- `darwin/Info.plist` and `Info.dev.plist` contain the app identity, minimum macOS
  version, and microphone permission description.
- `darwin/entitlements.plist` contains the audio-input entitlement for signing
  a Mac build with the hardened runtime.

Keep the PNG and ICO in sync when changing the artwork. Wails preserves an
existing ICO rather than regenerating it.

`config.yml` configures v3 development and the embedded update-check version.
The Taskfiles build the frontend, generate v3 bindings and Windows resources,
and compile Go with `production` for releases or `dev` for development. Native
metadata files contain concrete values; keep their versions in sync with
`info.version` in `config.yml`. `go test ./...` checks this.

Use `wails3 package` on macOS for an app bundle; Windows installers remain in
the separate release setup.

Executables, generated resources, installers, and local packaging files are
ignored. The ignore rules allow only the source inputs and Taskfiles under
`build/`. Build outputs go to `build/bin/`.

The checked-in `scripts/build-macos.sh` packages Whisper and FFmpeg inside the
Mac app, and `scripts/smoke-macos.sh` verifies those bundled tools. See
[Mac packaging](../docs/macos.md#build-a-self-contained-mac-package).
