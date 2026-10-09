# macOS notes

The Mac code was prepared on Windows. I haven't verified a native Mac build yet,
so treat this as work in progress. Build reports and fixes from Apple Silicon
or Intel Macs would be helpful.

The source includes native microphone capture, shortcuts, paste, a menu-bar item,
and a floating recording panel. The target is macOS 13.3 or newer, including its
system WebKit. Installing a newer standalone browser doesn't update Yap's webview.

## Build with Wails

Use a Mac with Xcode Command Line Tools (`xcode-select --install`), Go 1.26.x,
Node 22.12+, and Wails 2.16.0. From a clone of the repository:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
export MACOSX_DEPLOYMENT_TARGET=13.3
export CGO_CFLAGS="${CGO_CFLAGS:-} -mmacosx-version-min=13.3"
export CGO_LDFLAGS="${CGO_LDFLAGS:-} -mmacosx-version-min=13.3"
wails doctor
wails build
```

This builds for your Mac's architecture and writes `build/bin/yap.app`. Use
`wails dev` in the same shell for development. The repository includes the app
icon and both Wails plists, including the microphone permission description.

A source build doesn't bundle Whisper. Install or build a compatible
`whisper-cli` separately and select its executable in Settings before setting up
a speech model. The app doesn't automatically install a Mac runtime. If you're
preparing a self-contained bundle, the runtime belongs at
`Contents/Resources/whisper/whisper-cli`, together with its required libraries
and license.

The included audio-input entitlement is for builds signed with the hardened
runtime. Developer ID signing and notarization aren't needed for an ordinary
local Wails build.

## Build a self-contained Mac package

Use the checked-in packaging script to include **Whisper and FFmpeg**. End users
won't need Homebrew or a separately installed runtime. Speech models are still
downloaded in Yap during setup.

On a Mac, install Xcode Command Line Tools, Go 1.26.x, Node 22.12+, and CMake.
For example, with Homebrew already installed, `brew install cmake` supplies CMake.
The script uses the pinned Wails CLI, so a global Wails installation is optional.
Use a checkout path without spaces (required by FFmpeg's build system).
From the repository root:

```bash
bash scripts/build-macos.sh arm64     # Apple Silicon
bash scripts/build-macos.sh amd64     # Intel
bash scripts/build-macos.sh universal # Both architectures (the default)
```

Use your Mac's architecture or `universal`: the mandatory smoke test runs the
finished binaries on the build host. Testing an Intel-only bundle on Apple
Silicon requires Rosetta; an Intel Mac cannot execute an ARM-only bundle.

The script verifies pinned source archive hashes, builds each architecture
separately, combines universal binaries, and places them at:

- `Contents/Resources/whisper/whisper-cli` (Whisper.cpp 1.9.2, Metal enabled).
- `Contents/Resources/ffmpeg/ffmpeg` (FFmpeg 9.0.2, LGPL v2.1 or later).

It rejects non-system dynamic library dependencies, runs Go tests/vet and
frontend typechecking, signs the tools and app, and runs a native smoke test.
The test downloads a temporary Tiny model and speech sample, tests transcription,
then compresses the sample to FLAC and M4A and tests decoding and transcription.
Its temporary files are removed on exit. Source/build caches remain in
`build/macos-work`; the first build needs internet access and takes longer.

Outputs are `build/bin/yap.app`, `build/bin/Yap-<version>-macos-<target>.zip`, and
the ZIP's `.sha256` file. No credentials are required for the default ad hoc
signature, intended for local testing. For distribution, supply your Developer
ID identity and a previously configured notarytool keychain profile:

```bash
CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
NOTARY_PROFILE='your-notary-profile' \
bash scripts/build-macos.sh universal
```

That submits the archive to Apple, staples the accepted ticket, and regenerates
the ZIP and checksum. FFmpeg's exact source archive, licence, build script and
per-architecture configuration are included inside the app, alongside the
executable. GPL/nonfree components and external codec-library autodetection are
disabled. FFmpeg runs as a separate process; Yap isn't linked to its libraries.

To repeat the runtime smoke test on another Mac:

```bash
bash scripts/smoke-macos.sh /Applications/yap.app
```

The script was prepared on Windows. Native compilation, signing/notarization,
and end-to-end operation still need verification on macOS before release.

## First launch

Once you have a native build:

1. Open Yap and download a speech model from Models. A packaged build discovers
   Whisper automatically. For a plain Wails/dev build, first select your local
   Whisper executable in Settings. An explicitly selected external runtime
   continues to take precedence over the bundled one.
2. Allow microphone access when prompted. Finish the permission prompt before
   retrying a recording.
3. Allow Yap under **System Settings → Privacy & Security → Accessibility** for
   shortcuts and paste. Yap requests the macOS permission prompt on its first
   registration attempt when access is missing, at most once per launch.
   If Yap isn't listed, use **+** to add the app you're running. Return to Yap
   after enabling access: it retries the saved shortcut automatically. You can
   also click **Retry shortcut** in Setup or Settings without changing your
   shortcut. Input Monitoring may also be needed; if access is enabled and the
   shortcut still fails, quit and reopen Yap.
4. Focus a text field, hold **Control+Option+Space**, speak, and release Space.
   Settings calls this `Ctrl+Alt+Space`; Alt means Option on a Mac.

If paste isn't possible, look in History or use the clipboard. Yap won't move
focus back to the target window. Data is stored in
`~/Library/Application Support/yap`.

Closing the window keeps Yap in the menu bar. Reopen it from there or the Dock;
**Quit Yap**, Cmd+Q, and Dock Quit exit. Launch at login uses
`~/Library/LaunchAgents/com.yap.desktop.login.plist`. If you move the app, open
the new copy and save the startup setting again.

## Optional audio formats

WAV import and microphone recording need no extra software. Other formats need
FFmpeg, which the packaging script includes. For a plain Wails/dev build, you
can install it separately with `brew install ffmpeg`.

Yap checks the app's bundled FFmpeg first, then PATH, `/opt/homebrew/bin/ffmpeg`,
and `/usr/local/bin/ffmpeg`, including when launched from Finder. Reopen Yap
after installing. See
[Audio support](audio-support.md) for supported formats and Windows downloads.

## Testing on a Mac

The desktop behavior still needs testing, particularly:

- Microphone permission on first launch, denial, and retry.
- Shortcut hold/release and toggle mode, including non-US keyboard layouts.
- Accessibility prompt on first launch without access; denial must leave clear
  guidance without repeated prompts. Grant access, return to Yap, and verify
  the error clears and the saved shortcut works without restarting. Also test
  the Retry shortcut button and ensure retry does not save unsaved settings.
- Paste into another app, and clipboard fallback after switching windows.
- The floating panel's focus, dragging, and position after disconnecting a display.
- Closing to the menu bar, reopening, and quitting during recording.
- Launch at login, including after moving the app.
- Setup, History, Settings, and both themes on macOS 13.3's system WebKit.

Test on both Apple Silicon and Intel before calling a release universal. A
successful run on one doesn't verify the other.
