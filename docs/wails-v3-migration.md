# Wails v3 migration

Yap uses Wails **v3.0.0** and `@wailsio/runtime` **3.0.0**. Install the matching
CLI with `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0`.
The [official migration guide](https://v3.wails.io/migration/v2-to-v3/) describes
the framework changes.

`wails3 build` creates `build/bin/yap.exe` on Windows. `wails3 dev` starts Vite on
port 9245 and rebuilds the backend with the `dev` tag. Release builds use the
`production` tag and retain the single-instance application identity
`com.yap.desktop`; development builds keep their own process. On macOS,
`wails3 package` creates `build/bin/yap.app`.

The root and platform Taskfiles replace the v2 build configuration. Build
metadata and development settings live in `build/config.yml`. Native Windows
resources and macOS plists contain concrete values rather than v2 templates.
Keep their version fields in sync; the Go tests check them.

The backend is registered as a v3 service. Wails windows and tray resources are
configured during service startup; hotkeys and audio start after the application
event loop starts. The main window stays hidden until startup and
the webview runtime are ready. Its closing hook preserves close-to-tray, and
application shutdown releases the existing native integrations and storage.
The `ShouldQuit` gate cancels and drains workers asynchronously before native
shutdown, keeping the UI loop available for pending clipboard and window calls.

System tray menus use Wails' `SystemTray` and `Menu` APIs on Windows and macOS.
The former Win32 message loop, notification-icon code, and AppKit delegate
replacement have been removed. The tray is configured during service startup
before Wails starts its native resources. Menu state updates are coalesced on
the main thread; queued updates become no-ops after shutdown. Window close
hides to the tray on both platforms, while application Quit still exits.
Dock reopen uses Wails' application event to restore the main window even while
the recording indicator is visible. Its hook prevents the default Dock handler
from reopening an idle indicator alongside the main window.
Linux keeps its existing close-as-exit behavior until native tray availability
and fallback behavior can be verified on a Linux desktop.

The floating indicator is a separate, always-on-top, frameless Wails webview on
Windows and macOS. `frontend/indicator.html` mounts a dedicated React component
that reuses the application's shadcn buttons and theme. It does not mount the
main React app, duplicate its effects, or receive transcript
contents. The existing Go presentation rules still own labels, actions, elapsed
time and notification expiry. A frontend-ready handshake restores current state
after loading or reloading; stale button revisions cannot affect a newer session.
Stop and Cancel also carry a backend session ID, revalidated under the app mutex
when the asynchronous callback runs.

Small platform helpers preserve non-activation and saved geometry. Windows uses
`WS_EX_NOACTIVATE`, explicit topmost/tool-window flags and activation/focus
guards for the indicator and its hosted webview; macOS uses a non-activating
Wails panel with key-window suppression. Pointer dragging avoids Wails' Windows
native move loop, which explicitly sets focus. Both platforms clamp saved
positions to the available work area. Existing Windows `indicator-position.json`
coordinates and the macOS `YapDictationIndicator` frame preference are retained.
Ordinary refreshes keep the macOS panel on its current monitor; initial placement
can select the monitor under the mouse until the user saves a position by dragging.
The former GDI and AppKit control rendering and separate native message loop have
been removed. Theme changes and reduced-motion meter behavior remain supported.

Bindings are generated into `frontend/bindings` with
`wails3 generate bindings -ts -i -names`. Interfaces preserve the original JSON
shape so an incompatible backend cannot be hidden by generated default values.
The frontend normalizes nullable Go slices at the bridge boundary. Event
handlers read v3's `event.data`; multiple payload arguments arrive as an array.
Native file drops use the v3 drop target and window event, then resolve through
the existing audio-import queue. Recovery clipboard controls use the v3 runtime
independently of the application's context providers.

Browser tests use the actual v3 runtime and named bindings through a test-only
in-memory transport. The production bundle does not load that transport.

The Go module and JavaScript runtime are both pinned to the latest stable
v3.0.0 release checked during this migration. There was no external tray module
to remove from `go.mod`; `internal/tray` now only adapts Yap's menu state to Wails.
The remaining direct native dependencies still have active uses:

- `golang.design/x/hotkey` supplies ordered key-down and key-up events for
  hold-to-talk. Wails' global shortcut registration supplies a press callback,
  so it cannot replace the release handling.
- `github.com/ebitengine/purego` loads the native speech inference runtime.
- `golang.org/x/sys` remains in use for audio, storage, paste, and other native
  integrations.

Launch-at-login registrations retain their existing Windows registry value and
macOS LaunchAgent identity. Adopting Wails' autostart manager would require a
separate registration migration to prevent duplicate launches. Neither the
floating indicator nor autostart adds a removable third-party Go dependency.

This migration does not change the database schema, settings format, model
directories, backups, recordings, or application data directory. On Windows that
directory remains `%APPDATA%\yap`. Existing storage and backup regression tests
exercise the same code paths.

To roll back, quit Yap, revert the migration changes together, reinstall the
v2.16.0 CLI, and run `wails build` to regenerate the v2 frontend bridge and
executable. No data conversion is required. Avoid running both versions at once;
they share the same storage and hotkeys.

Native macOS and Linux compilation and desktop checks still require those
platforms. Windows installer packaging and signing remain in the separate
release setup. The local Windows helpers now read `build/windows/info.json`,
call `wails3 build`, and invoke NSIS explicitly. Their installer checks both
the v3 and legacy v2 mutex names before replacing an installed application.
Those release helpers and installer sources remain ignored local files.
