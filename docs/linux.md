# Linux

The Linux desktop app has been tested on Ubuntu x64 with GNOME Wayland, including
Debian installation, application search, and the app icon.

Yap installs verified Linux x64 and arm64 runtimes for Whisper 1.9.5, NVIDIA
Parakeet via NeMo-Speech.cpp 0.3.0, and Moonshine Voice 0.1.6. Choose a speech
model in **Models** or the setup guide to download its runtime and model together.
The managed runtimes use the CPU; Python, pip, and CUDA are not required.

Use a glibc distribution with a recent C++ runtime, such as Ubuntu 22.04 or newer.
Moonshine's Linux packages target glibc 2.34 on x64 and glibc 2.31 on arm64.
Alpine/musl is not supported by these prebuilt packages. Shared libraries stay
beside the runtimes in Yap's data directory; no PATH or LD_LIBRARY_PATH changes
are needed. Whisper can also use a custom `whisper-cli` selected in Settings.

## Build and run

Install Go 1.26+, Node 22.22+, and the native development libraries. On Ubuntu:

```sh
sudo apt install build-essential pkg-config libgtk-4-dev libwebkitgtk-6.0-dev libx11-dev libxext-dev
sudo apt install ffmpeg pulseaudio-utils xdotool xwayland at-spi2-core xdg-desktop-portal
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0
wails3 dev
```

Wails 3 uses GTK 4 and WebKitGTK 6.0 by default. On distributions that only ship
GTK 3 and WebKitGTK 4.1, install `libgtk-3-dev` and `libwebkit2gtk-4.1-dev` instead
and use `wails3 build EXTRA_TAGS=gtk3` for a production build. For development,
use `wails3 dev -tags gtk3`. Wails' `wails3 doctor` command can check build dependencies.

Use `wails3 build` for a production binary at `build/bin/yap`. Application data,
including models and runtimes, is under `$XDG_CONFIG_HOME/yap`, or
`~/.config/yap` when that variable is unset.

FFmpeg records the microphone through PulseAudio. PipeWire works when its
PulseAudio compatibility service is running. `pactl` from `pulseaudio-utils`
lists available microphones. PCM WAV imports can be transcribed without FFmpeg;
other import formats use the system FFmpeg installation.

Drag one or more audio files from your file manager onto Yap to import them.
The drop overlay appears while hovering; dropping adds the files to the existing
import queue. This works on Wayland and X11, including while recording. You can
also use **Import audio** to choose files.

## Package and install

On a Debian or Ubuntu build machine, install the packaging tools, then build:

```sh
sudo apt install dpkg-dev desktop-file-utils
wails3 package
```

This builds the production app and creates
`build/bin/yap-0.11.0-linux-amd64.deb` (or `linux-arm64.deb` on arm64). The filename
uses the version in `build/config.yml`. `wails3 package EXTRA_TAGS=gtk3` packages
a GTK 3 build when its development libraries are installed. Build natively for
the target architecture. Development binaries cannot be packaged.

The package installs `/usr/bin/yap`, the desktop launcher, and the application
icon. Native GTK, WebKitGTK, and glibc dependencies are derived from the exact
binary. A package built on a newer distribution may require newer libraries than
an older distribution provides. The speech-runtime requirements above do not
establish compatibility for the desktop app itself. The package also declares
FFmpeg, PulseAudio tools, xdotool, XWayland, AT-SPI, and desktop portal dependencies;
your desktop must supply a compatible portal backend.

Quit Yap, then install or upgrade with the package manager:

```sh
sudo apt install ./build/bin/yap-0.11.0-linux-amd64.deb
```

When testing a rebuilt package with the same version, add `--reinstall` to apt.

Open **Yap** from the desktop application menu. Upgrades preserve the data folder,
settings, history, and models. To uninstall, disable **Launch at login**, quit Yap,
and run `sudo apt remove yap`. User data is retained. RPM, AppImage, and Flatpak
packaging are not supplied.

Release builds use the Wails GitHub provider to check for compatible releases and
offer the Debian package for the current architecture. Choose **Download update**,
quit Yap, then install the package with apt. Linux upgrades use the system package
manager; the Wails executable-swap helper is not used. Release assets need a
matching `SHA256SUMS` entry, as described in [the updater guide](updater.md). A
release without that architecture's package or checksum is unavailable.

The optional package regression builds and extracts a package into temporary
storage, then checks application search and icon discovery with GLib/GTK. It
requires the production binary, Python GI, and GTK 4, and does not install anything:

```sh
YAP_PACKAGE_INTEGRATION=1 go test ./build/linux -run '^TestLinuxPackageDesktopIntegration$' -v -count=1 -timeout 45s
```

A final apt notice that a local package was read unsandboxed as root means `_apt`
could not traverse the package's directory. If apt reached **Setting up yap**,
installation succeeded. It does not require changing your home-directory permissions.

## Launch at login

In a production build, enable **Settings → General → Launch at login** to create
`$XDG_CONFIG_HOME/autostart/com.yap.desktop.desktop` (normally
`~/.config/autostart/com.yap.desktop.desktop`). The launcher records the current
executable path; enabling it again refreshes that path after moving a standalone
binary. Disabling removes the entry, or masks a system-provided entry. Development
builds leave login registration unavailable.

**Start in background** requires a working system tray host. GNOME needs an
AppIndicator extension as described below.

## Built-in text models

Gemma 4 E2B, E4B, and 12B are available under **Models → Text models**. Download
one, then choose **Use model** for text correction, prompts, titles, and chat.
Yap installs verified llama.cpp b12359 (v1.0.0) CPU and Vulkan runtimes automatically.
Vulkan setup is optional once the CPU runtime is usable. Yap tries GPU
acceleration first and falls back to CPU if loading fails. GPU
acceleration needs a working Vulkan loader and driver; CUDA is not required.

The pinned text runtimes require glibc 2.34 and GCC 12's C++ runtime on x64,
or glibc 2.38 and GCC 13's C++ runtime on arm64. Ubuntu 22.04 with updated
libraries works on x64; use Ubuntu 24.04 or newer on arm64. Both need OpenSSL 3
and the OpenMP runtime (`libgomp1`). Runtime libraries remain in Yap's data
folder. No Python or external model server is needed.

Downloads are approximately 3.35 GB (E2B), 5.15 GB (E4B), and 6.98 GB (12B), plus
working memory and context. Automatic context uses total system memory: 4,096
tokens below 12 GiB, 8,192 below 24 GiB, and 16,384 otherwise. You can choose a
smaller context under **Prompts → Text model** if memory is limited.

To verify real completion, streamed chat, context reload, and explicit CPU
inference with the smallest built-in model:

```sh
YAP_GEMMA_INTEGRATION=gemma-4-e2b go test ./internal/inference/text -run '^TestManagedGemmaIntegration$' -v -count=1 -timeout 20m
```

Set `YAP_GEMMA_INTEGRATION_DIR` to a dedicated directory to reuse verified
runtime and model downloads. Setting it to Yap's data directory makes the model
available in the app without changing the selected model or other settings.

## Desktop integration

Global shortcuts use Xlib on X11 and the desktop's Global Shortcuts portal on
Wayland. Wayland needs `xdg-desktop-portal` and a desktop backend that implements
Global Shortcuts, such as recent GNOME or KDE Plasma. Allow the shortcut in the
system dialog if prompted; the desktop can let you configure its combination.
Both hold-to-talk and toggle mode use the portal's press/release events. For an
unpackaged build, Yap creates a hidden desktop entry under
`$XDG_DATA_HOME/applications` (normally `~/.local/share/applications`) so the
portal can identify the application. Existing installed desktop entries are preserved.
When an installed launcher becomes available, Yap removes its own older hidden
helper so that it cannot hide the installed app from the application menu.
This cleanup runs before shortcut setup and single-instance handoff. If a
previous development build left Yap missing from application search after its
first installation, run `yap` once from a terminal to clear that generated helper.

KDE shortcuts use a separate hidden `com.yap.shortcuts` identity. KDE reserves
component names ending in `.desktop` for launcher actions, so the installed
launcher identity cannot own these press/release bindings. The launcher stays
the same, and other desktops keep their existing shortcut permission identity.
KDE asks for shortcut permission for the new identity on its first use.

On X11, Yap requests detectable auto-repeat for its own keyboard connection and
filters legacy repeat release/press pairs. Holding a shortcut therefore keeps
recording until release without changing the desktop's keyboard repeat settings.

Pasting into another app on X11 requires `xdotool`. On Wayland, background
clipboard writes and automatic paste use the Clipboard and Remote Desktop
portals. On the first copy, enable **Allow Remote Interaction** and choose
**Share** in the system dialog. Yap requests keyboard and clipboard access,
keeps the session for subsequent dictations, and stores a private restore token
in its data directory so supported desktops can remember the permission across
restarts. Before automatic paste, Yap checks that the same accessible window
that started dictation still has focus. Switching windows prevents automatic
paste and leaves the text on the clipboard. Apps without an observable active
AT-SPI window receive clipboard-only delivery. The guard distinguishes separate
windows of the same application. Wayland does not expose arbitrary global
modifier state, so release shortcut modifiers before pasting. If access is
denied, Yap reports the clipboard failure and keeps the transcript available.
Use the microphone button or audio-file import if your desktop has
no Global Shortcuts portal.

Permission dialogs leave snapshots, cancellation, and shutdown responsive. Cancel
in Yap or in the system shortcut dialog ends the pending request without opening
another shortcut dialog. If the portal restarts, closes the session, removes the
binding, or changes its effective trigger, Yap marks the shortcut unavailable
and exposes the existing retry action. Unexpected session loss also releases a
held recording shortcut. If the desktop returns a shortcut without an assigned
key, Yap reports it as unavailable. Choose another combination or assign it in
desktop settings, then retry. On KDE, Yap also checks the active assignment
when KGlobalAccel is available, since a conflicting request can return a trigger
description without an assigned key. Clipboard permission is requested again
when its saved session becomes unavailable.

The opt-in Wayland shortcut test requests Ctrl+Shift+F12 and verifies actual
press and release events. Run it in the desktop session, approve the permission
dialog, then press and release the requested combination:

```sh
YAP_SHORTCUT_INTEGRATION=1 go test ./internal/platform -run '^TestWaylandShortcutDesktopIntegration$' -v -count=1 -timeout 3m
```

Set `YAP_SHORTCUT_TEST_KEY` to an available combination if needed, for example
`YAP_SHORTCUT_TEST_KEY=Ctrl+Shift+F11`. The test uses a separate application
identity so it does not replace Yap's shortcuts. It fails if the desktop leaves
the requested shortcut unassigned; Ctrl+F12 conflicts with Plasma's default
Show Desktop binding.

The opt-in X11 regression holds a shortcut past the server's auto-repeat delay,
then checks release and three quick taps. It requires XTest (`libXtst`) and
`xset`, and uses the same configurable `YAP_SHORTCUT_TEST_KEY` default:

```sh
YAP_X11_SHORTCUT_INTEGRATION=1 go test ./internal/platform -run '^TestX11ShortcutRepeatIntegration$' -v -count=1 -timeout 20s
```

Run it on an X11 session with keyboard auto-repeat enabled, or under `xvfb-run`
with `XDG_SESSION_TYPE=x11`. Choose an unused test key if the default is assigned.

App assignments in **Settings → Profiles** list open applications and select
their assigned profile when recording starts through a global shortcut. X11
uses `xdotool`; Wayland uses the desktop accessibility service (`at-spi2-core`)
and supports applications that expose their windows and active state through
AT-SPI, including GTK and Electron apps. Applications without that interface
use the manually selected profile. Rules match the executable name, so several
windows of the same app share one assignment. No GNOME Shell extension is needed.

To check app enumeration and focused-app matching on your desktop:

```sh
YAP_APPLICATIONS_INTEGRATION=1 go test ./internal/platform -run '^TestLinuxApplicationsIntegration$' -v -count=1
```

## Floating indicator

The floating indicator shows recording time, microphone level, the active
profile, and processing status while Yap is in the background. Stop and Cancel
leave keyboard focus in the dictation target. Drag the indicator to move it;
its position is remembered and kept within the monitor's work area. It hides
while Yap's main window has focus and when a notification expires or is dismissed.

On Wayland, the indicator uses a separate XWayland window because GNOME's native
Wayland protocol cannot position an always-on-top, non-activating overlay. The
main window keeps its original display backend. XWayland and a working `DISPLAY`
are required; Ubuntu's GNOME session normally provides both. No shell extension
or additional permission dialog is needed. If X11/XWayland is unavailable, Yap
reports the indicator error and retains the recording controls in the main window.

Build the frontend, then exercise the real status window, its controls, focus
preservation, dismissal, and repeated recordings without recording audio:

```sh
YAP_INDICATOR_SMOKE=1 go test ./internal/indicator -run '^TestNativeIndicatorLinux$' -v -count=1 -timeout 30s
```

## System tray

Yap uses Wails' native StatusNotifierItem tray on Linux. KDE Plasma provides a
host by default. GNOME needs AppIndicator support, such as Ubuntu's
`gnome-shell-extension-appindicator` extension, enabled in the Extensions app.

Left-click the icon to open Yap; right-click for recording, cancellation,
history, settings, and **Quit Yap**. Closing the window keeps Yap running in the
tray. If the desktop has no available tray host, Yap reports that background
controls are unavailable and closing the window exits normally.

To exercise the actual desktop tray registration, menu updates, click handlers,
and shutdown without changing Yap's data or recording audio:

```sh
YAP_TRAY_SMOKE=1 go test ./internal/tray -run '^TestNativeLinuxTray$' -v -count=1 -timeout 25s
```

## Verify speech runtimes

Normal tests do not download models:

```sh
go test ./...
go vet ./...
```

These opt-in tests download pinned packages, verify model integrity, and
transcribe the upstream JFK sample. The native suite covers all four Moonshine
models and Parakeet, including process cancellation. Allow roughly 1.4 GB for
the combined model and runtime downloads:

```sh
YAP_INTEGRATION=1 go test ./internal/models -run '^TestRealWhisper' -v -count=1 -timeout 15m
YAP_NATIVE_INTEGRATION=1 go test ./internal/models -run '^TestRealNativeModels$' -v -count=1 -timeout 25m
```

Tests use temporary storage by default. Set `YAP_NATIVE_INTEGRATION_DIR` to a
dedicated directory to keep verified downloads between runs. Pointing it at
Yap's data directory makes the installed models available in the desktop app;
the tests do not change the selected model or other settings.

To check live microphone capture and level updates through PulseAudio/PipeWire:

```sh
YAP_MICROPHONE_INTEGRATION=1 go test ./internal/audio -run '^TestLinuxMicrophoneCaptureIntegration$' -v -count=1 -timeout 30s
```

This records two seconds each from the default and first listed microphone,
reports captured duration and peak level, and deletes the temporary recordings.
