# Building on Windows

Windows 10/11 x64 is Yap's main target. A regular Wails build produces a portable
executable; you don't need an installer or signing tools to run it.

## Requirements

- Go 1.26 or newer.
- Node 22.12 or newer, with npm.
- Wails CLI 2.16.0.
- Microsoft Edge WebView2 Runtime.

A C compiler isn't required. SQLite uses a pure-Go driver, and speech recognition
runs through a separate Whisper executable downloaded during model setup.

## Build and run

From a clone of this repository:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
wails doctor
wails build
.\build\bin\yap.exe
```

Make sure Go's binary directory (usually `%USERPROFILE%\go\bin`) is on PATH.
`wails doctor` can help identify missing tools or WebView2. The build installs
frontend dependencies and generates bindings and frontend assets automatically.
The icons, manifest, and version metadata are already in the repository.

On first launch, follow setup to download a speech model and test your microphone.
Those downloads need internet; dictation after setup works offline.

## Development

Run `wails dev` from the repository root and leave the terminal open. Changes to
the frontend reload through Vite; Go changes rebuild the app. Use Ctrl+C to stop
the watcher.

Closing the app window hides it to the tray. Choose **Quit Yap** before replacing
a running executable, or use `wails build -o yap-dev.exe` to build another file.
Avoid running multiple copies that try to register the same global shortcut.

## Local data and distribution

Settings and history are stored in `%APPDATA%\yap`, separately from the executable.
Replacing a portable build doesn't remove that data.

Source builds are unsigned. Windows may warn when an executable is downloaded
from another computer. Installer packaging, signing, and website publishing are
maintained separately and aren't required for this build.

## Release update checks

Windows x64 builds check the latest public stable release in
`benjaminraffetseder/yap` using GitHub's Releases API. This is enabled in ordinary
`wails build` output; no website feed, `release.json`, account, or token is needed.
Development builds skip automatic network checks, while manual checks still work.
macOS and Linux do not offer Windows installers.

For each release:

1. Bump `info.productVersion` in `wails.json`, for example to `0.2.0`.
2. Build the Windows installer with your release packaging and signing setup.
3. Create a draft GitHub release tagged `v0.2.0` and add release notes.
4. Upload `yap-0.2.0-windows-amd64-setup.exe` and its checksum before publishing.
5. Publish the release as a stable release and mark it as latest.

The tag must match the compiled version: three numeric components, with an
optional leading `v`. The installer filename must match the exact version and
Windows x64 naming pattern above. Drafts, prereleases, and incomplete or empty
installer uploads cannot become update downloads. A tag alone does not publish
an update. Release notes come from the GitHub release body and are displayed as
plain text with a preview of at most 8000 UTF-8 bytes.

The separate local `scripts/build-windows.ps1` helper defaults to this repository
and still supports `-SelfSign`. Its website manifest and `-PrepareLanding` option
remain useful for website downloads, but the app no longer reads that manifest.
These packaging helpers remain ignored local files; they aren't needed for a
regular source build. Build and sign locally, then attach the installer and
checksum to the draft GitHub release.

If releases move to a separate public GitHub repository, select it at build time:

```powershell
wails build -ldflags "-X main.updateRepository=owner/yap-releases"
```

The local installer helper accepts the corresponding
`-UpdateRepository owner/yap-releases` option. Never embed GitHub credentials in
the application; the release repository must be public.

Production builds check at startup, at most once every 24 hours across restarts,
including failed attempts. **Settings → General → App updates → Check for updates**
checks immediately. Results are cached in `%APPDATA%\yap\update-check.json`.
Offline checks leave dictation running and retain a previously discovered update.
GitHub rate limits show retry guidance. If GitHub returns no public latest
release, Settings says that no public GitHub release is available yet, rather
than claiming the app is up to date. Old website-feed cache entries are ignored.
Users on older builds without the checker must manually install a release that
includes it once; subsequent releases can then be discovered inside Yap.

**Download update** opens the validated installer link in the system browser.
The user quits Yap from the tray and runs setup to upgrade in place. This flow
does not automatically download, verify, or execute the installer. Metadata uses
HTTPS and stays on the API host; installer URLs must match the configured GitHub
repository, release tag, and expected filename. Authenticated update signatures
would be required before adding automatic installation.
