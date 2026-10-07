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
No local release scripts or private packaging files are needed.

A source build doesn't bundle Whisper. Install or build a compatible
`whisper-cli` separately and select its executable in Settings before setting up
a speech model. The app doesn't automatically install a Mac runtime. If you're
preparing a self-contained bundle, the runtime belongs at
`Contents/Resources/whisper/whisper-cli`, together with its required libraries
and license.

The included audio-input entitlement is for builds signed with the hardened
runtime. Developer ID signing and notarization are separate distribution steps;
they aren't needed for an ordinary local Wails build.

## First launch

Once you have a native build:

1. Open Yap, select your local Whisper executable in Settings, and download a
   speech model from Models.
2. Allow microphone access when prompted. Finish the permission prompt before
   retrying a recording.
3. Allow Yap under **System Settings → Privacy & Security → Accessibility** for
   shortcuts and paste. Input Monitoring may also be needed. Quit and reopen
   Yap after changing these permissions.
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
FFmpeg. If you use Homebrew, install it with `brew install ffmpeg`.

Yap checks PATH, `/opt/homebrew/bin/ffmpeg`, and `/usr/local/bin/ffmpeg`, including
when launched from Finder. Reopen Yap after installing. See
[Audio support](audio-support.md) for supported formats and Windows downloads.

## Testing on a Mac

The desktop behavior still needs testing, particularly:

- Microphone permission on first launch, denial, and retry.
- Shortcut hold/release and toggle mode, including non-US keyboard layouts.
- Paste into another app, and clipboard fallback after switching windows.
- The floating panel's focus, dragging, and position after disconnecting a display.
- Closing to the menu bar, reopening, and quitting during recording.
- Launch at login, including after moving the app.
- Setup, History, Settings, and both themes on macOS 13.3's system WebKit.

Test on both Apple Silicon and Intel before calling a release universal. A
successful run on one doesn't verify the other.
