# Building on Windows

Windows 10/11 x64 is Yap's main target. A regular Wails build produces a portable
executable; you don't need an installer or signing tools to run it.

## Requirements

- Go 1.26 or newer.
- Node 22.22 or newer, with npm.
- Wails CLI 3.1.0.
- Microsoft Edge WebView2 Runtime.

A C compiler isn't required. SQLite uses a pure-Go driver, and speech recognition
runs through a separate Whisper executable downloaded during model setup.

## Build and run

From a clone of this repository:

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0
wails3 doctor
wails3 build
.\build\bin\yap.exe
```

Make sure Go's binary directory (usually `%USERPROFILE%\go\bin`) is on PATH.
`wails3 doctor` can help identify missing tools or WebView2. The build installs
frontend dependencies and generates bindings and frontend assets automatically.
The icons, manifest, and version metadata are already in the repository.

On first launch, follow setup to download a speech model and test your microphone.
Those downloads need internet; dictation after setup works offline.

## Development

Run `wails3 dev` from the repository root and leave the terminal open. Changes to
the frontend reload through Vite; Go changes rebuild the app. Use Ctrl+C to stop
the watcher.

Closing the app window hides it to the tray. Choose **Quit Yap** before replacing
a running executable, or use `wails3 build APP_NAME=yap-dev` to build another file.
Avoid running multiple copies that try to register the same global shortcut.

## Local data and distribution

Settings and history are stored in `%APPDATA%\yap`, separately from the executable.
Replacing a portable build doesn't remove that data.

Source builds are unsigned. Windows may warn when an executable is downloaded
from another computer. Installer packaging, signing, and website publishing are
maintained separately and aren't required for this build.

## App updates

Yap uses the Wails v3 updater and its GitHub Releases provider. Production builds
quietly check the latest stable release at startup, at most once every 24 hours
across restarts, including failed attempts. **Settings → General → App updates →
Check for updates** checks immediately. Development builds allow manual checks
but skip automatic requests and refuse installation over a development binary.

**Install update** opens the Wails update window, downloads and verifies the
release, and stages it beside the installed executable. **Restart & Apply**
starts Wails' helper, shuts down Yap through its normal cleanup, swaps the
executable, and relaunches. Closing the update window after staging leaves a
**Restart & Apply** action in Settings and the command menu. The installation
directory must be writable; per-user and portable installations support this.
The updater does not request administrator privileges for a protected directory.

For release assets, checksums, compatibility with older builds, and rollback,
see [the updater release guide](updater.md). Existing installer packaging and
website publishing remain separate from the in-app updater.
