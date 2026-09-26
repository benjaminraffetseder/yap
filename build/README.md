# Wails build files

These are source inputs to `wails dev` and `wails build`, not generated output.

- `appicon.png` is the source app icon used by Wails.
- `windows/icon.ico` is the Windows app and tray icon.
- `windows/info.json` supplies executable version metadata from `wails.json`.
- `windows/wails.exe.manifest` configures Windows common controls and DPI support.
- `darwin/Info.plist` and `Info.dev.plist` contain the app identity, minimum macOS
  version, and microphone permission description.
- `darwin/entitlements.plist` contains the audio-input entitlement for signing
  a Mac build with the hardened runtime.

Executables, generated resources, installers, and local packaging files are
ignored. The ignore rules allow only the source inputs listed above and this
README. Build outputs go to `bin/`.
