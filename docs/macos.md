# macOS notes

The Mac code was prepared on Windows. I haven't verified a native Mac build yet,
so treat this as work in progress. Build reports and fixes from Apple Silicon
or Intel Macs would be helpful.

The source includes native microphone capture, shortcuts, paste, and a floating recording panel. The target is macOS 12.0 or newer, including its
system WebKit. Installing a newer standalone browser doesn't update Yap's webview.

## Build with Wails

Use a Mac with Xcode Command Line Tools (`xcode-select --install`), Go 1.26+,
Node 22.12+, and Wails 2.16.0. From a clone of the repository:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
export MACOSX_DEPLOYMENT_TARGET=12.0
export CGO_CFLAGS="${CGO_CFLAGS:-} -mmacosx-version-min=12.0"
export CGO_LDFLAGS="${CGO_LDFLAGS:-} -mmacosx-version-min=12.0"
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
2. Allow microphone access when prompted.
3. Allow Yap under **System Settings → Privacy & Security → Accessibility** for
   shortcuts and paste. Input Monitoring may also be needed. Quit and reopen
   Yap after changing these permissions.
4. Focus a text field, hold **Control+Option+Space**, speak, and release Space.
   Settings calls this `Ctrl+Alt+Space`; Alt means Option on a Mac.

If paste isn't possible, look in History or use the clipboard. Yap won't move
focus back to the target window. Data is stored in
`~/Library/Application Support/yap`.

## Testing on a Mac

The desktop behavior still needs testing, particularly:

- Microphone permission on first launch, denial, and retry.
- Shortcut hold/release and toggle mode.
- Paste into another app, and clipboard fallback after switching windows.
- The floating panel and keyboard focus while another app is active.
- History, Settings, and both themes on the system WebKit.

Test on both Apple Silicon and Intel before calling a release universal. A
successful run on one doesn't verify the other.
