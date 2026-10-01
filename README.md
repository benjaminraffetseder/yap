# Yap

Local dictation for your desktop. Hold a shortcut, speak, and release it to paste
the transcript into the app you're using.

Yap uses whisper.cpp for speech recognition and keeps recordings and transcripts
on your computer. No account or cloud transcription service needed. The desktop
app is built with Go, Wails, React, and TypeScript.

This is a personal project, with Windows as the main target. It's still early:
macOS has native code but hasn't been tested on a Mac yet.
Linux support is incomplete.

## What it does

- Hold-to-talk or toggle recording with a global shortcut.
- Dictate in the background, with tray controls and a floating indicator.
- Search, edit, copy, and export past transcripts.
- Add names and preferred spellings to a custom vocabulary.
- Run cleanup or custom prompts through an optional local text model.

## Getting started

On Windows 10/11 x64, [build from source](#build-from-source) and open
`build/bin/yap.exe`. WebView2 is required.

1. Open Yap and follow the setup guide to download a speech model and test your
   microphone. Small balances speed and accuracy; Base and Tiny are smaller options.
2. Put the cursor in a text field in another app.
3. Hold **Ctrl+Alt+Space**, speak, then release **Space**.

The first model download needs internet. Dictation works offline after that.
You can also record with the microphone button in Yap; this copies the result
without pasting into another app.

Closing the window leaves Yap running in the tray. Choose **Quit Yap** from the
tray menu to exit. Settings lets you change the shortcut, microphone, recording
mode, and startup behavior.

See [Using Yap](docs/usage.md) for settings, history, and troubleshooting.
[Windows build notes](docs/windows.md) cover prerequisites and troubleshooting.

## Privacy

Speech recognition runs on your computer. Yap has no analytics and doesn't
upload audio. Models and the speech runtime download only when requested.

History is saved locally. Keeping audio recordings is off by default; temporary
audio is removed after use, though a forced shutdown can leave files behind.
History and retained recordings are **not encrypted**.
On Windows, the data folder is `%APPDATA%\yap`.

Optional text processing connects to a model server on localhost. Use a model
that runs locally: Yap can't stop that server from forwarding requests elsewhere.

## Build from source

For Windows, you'll need Go **1.26+**, Node **22.12+**, Wails CLI **2.16.0**,
and WebView2. A C compiler isn't needed for the Windows build.

```powershell
git clone https://github.com/benjaminraffetseder/yap.git
cd yap
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
wails build
```

The result is `build/bin/yap.exe`. Wails installs frontend dependencies, generates
the JavaScript bindings, and builds the frontend. No installer scripts, private
files, or manual asset copying are needed. Make sure Go's binary directory is on
PATH so the `wails` command is available.

For development, run `wails dev` from the same directory and leave the terminal
open. The repository includes the native manifests, permission descriptions,
version metadata, and icons used by Wails. Generated files, installers, signing
helpers, and the separate website aren't part of the source build.

### Other platforms

See the [macOS notes](docs/macos.md) for native Wails build instructions.
Native compilation and desktop testing are still pending.

Linux has X11 adapters using FFmpeg/PulseAudio and xdotool, but no native tray
or floating indicator yet. It needs a manually configured Whisper runtime.
Wayland shortcuts and paste aren't supported.

## Working on Yap

The Go backend lives in `app*.go` and `internal/`; the React app is in
`frontend/src`. [Development notes](docs/development.md) cover the layout,
frontend workflow, and optional tests.

The usual checks are:

```powershell
go test ./...
go vet ./...
cd frontend
npm run typecheck
npm run build
```

Bug reports and small fixes are welcome. Include your OS, Yap version, and steps
to reproduce the problem. For a larger change, open an issue first so we can
discuss it before you spend time on it.

## License

[MIT](LICENSE). Third-party code and downloaded runtimes keep their own licenses.
