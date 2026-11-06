# Development

Yap has a Go backend and a React 19/TypeScript frontend, connected by Wails v3.
The UI uses Tailwind v4 and shadcn/ui with Base UI components.

## Running locally

See the [README](../README.md#build-from-source) for tool versions. From the repo
root, run `wails3 dev` and leave the terminal open. It rebuilds Go changes and
serves the frontend with Vite. Ctrl+C stops the watcher; closing the app window
only hides it to the tray.

Run one dev session per checkout. If port 9245 is occupied, stop the previous
Vite process before starting another. Restart `wails3 dev` if the frontend reports
that its backend bindings are out of date.

For frontend work in a browser, first run `wails3 build` to generate bindings:

```powershell
cd frontend
npm ci
npm run dev
```

The browser preview can't use the microphone, clipboard, file dialogs, or global
shortcuts through Wails. Use the desktop app to test those.

## Where things live

| Path | Purpose |
| --- | --- |
| `main.go` | Window setup and app entry point |
| `app*.go` | Recording state and methods exposed to the frontend |
| `internal/audio` | Capture, decoding, and WAV import |
| `internal/platform` | Global shortcuts and text insertion |
| `internal/tray` | Wails v3 system tray menu and recording-state adapter |
| `internal/indicator` | Frameless Wails indicator, presentation and platform focus/geometry helpers |
| `internal/startup` | Existing launch-at-login registrations |
| `internal/inference` | Whisper CLI and local text-server clients |
| `internal/models` | Model/runtime downloads and verification |
| `internal/storage` | SQLite, history, retention, and backups |
| `frontend/src` | Pages, components, and bridge helpers |
| `build` | Wails icons, native manifests, and version metadata |

Keep platform-specific code in the existing `_windows`, `_darwin`, and `_other`
files with matching build tags. Bound Go structs use camelCase JSON fields.
Wails generates `frontend/bindings`; don't edit it by hand.

The main UI and floating indicator are separate Vite entry points. Keep the
indicator in `frontend/src/components/indicator.tsx`, mounted by
`frontend/src/indicator.tsx`, independent of the main app's providers and
background effects. Reuse the shared shadcn components and theme. It receives
presentation via Wails events and sends versioned actions back to the indicator
controller.

The local hotkey dependency has a small event-ordering patch. Keep the `replace`
in `go.mod`; [the patch notes](../third_party/hotkey/README.md) explain why.
Wails' global shortcuts provide press callbacks; hold-to-talk also needs key-up
events, so the hotkey module remains necessary. The tray itself uses Wails v3.

To add a UI component, run `npm run ui:add -- <component>` from `frontend`.
Use the existing Base UI components and theme rather than introducing another
component library.

Interface translations use i18next and react-i18next, following the
[Wails React/TypeScript template](https://github.com/benjaminraffetseder/wails-react-ts-shadcn-template).
Both entry points initialize `frontend/src/i18n/index.ts`. Add matching keys to
`frontend/src/i18n/locales/en.json` and `de.json`, and use `useTranslation()` in
components. The English catalog supplies the TypeScript key definitions. Use
interpolation and plural forms for counts; format dates and numbers with the
resolved interface language.

The `desktop-language` preference is stored locally and synchronized between
webviews. It is independent of the backend's spoken-language setting. Keep
model IDs, language codes, profile names, transcripts, and saved prompt instructions
unchanged. Known native status messages are localized at display time through
`frontend/src/i18n/native-text.ts`; raw backend details remain available.

### UI state and asynchronous actions

`DraftProvider` keeps unsaved edits in memory across navigation. Home result edits
require **Apply changes**; the History transcript editor saves automatically.
Home drafts belong to a session ID and result revision: preserve a draft when
returning to the same result, and do not apply it to a replacement result. Cancel
discards the Home draft; a successful Apply must leave it clean.

Keep output-generation requests mounted while the inline transcript editor is
open. Hiding the detail tabs preserves their request owner; unmounting it cancels
the request. Copy confirmation must also belong to the text version that started
the request, so a late reply cannot confirm a different tab's text.

## Build files

The tracked files in `build/` are inputs to Wails: the icons, Windows manifest
and version metadata, and macOS plists and entitlements. Keep them in the repo;
`wails3 build` uses them directly. The Mac plists include the microphone permission
description and minimum OS version.

Generated output under `build/bin`, Wails-generated installer files, and local
release tooling are ignored. `scripts/` contains only local release helpers and
isn't needed for `wails3 dev` or `wails3 build`. No installer or signing tools are
needed to build the app.

The landing site is maintained separately. It isn't needed to build or run Yap.

## Tests

```powershell
go test ./...
go vet ./...
cd frontend
npm run typecheck
npm run build
npx playwright install chromium
npm run test:ui
```

The browser tests use the real Wails v3 runtime with an in-memory test transport
(`tests/wails-mock.ts`) and a separate Vite cache, so they
can run alongside `wails3 dev`.
They cover draft navigation, stale-result checks, output/chain continuity while
editing, and delayed clipboard replies. They do not prove native microphone,
global-shortcut, paste, or live-model behavior. For animated UI assertions, poll
the expected end state instead of assuming two animation frames finish a transition.

Native and download tests are opt-in. Run them from the repo root on Windows:

| Environment variable | Command | What it exercises |
| --- | --- | --- |
| `YAP_INDICATOR_SMOKE=1` | `go test ./internal/indicator -run '^TestNativeIndicator' -v -count=1` | Build the frontend first; real Wails window, controls, focus, dragging and saved geometry on Windows |
| `YAP_SHUTDOWN_SMOKE=1` | `go test . -run '^TestNativeShutdown$' -v -count=1 -timeout 15s` | Wails quits while a worker holds the app mutex and awaits the UI thread, without changing the clipboard |
| `YAP_TRAY_SMOKE=1` | `go test ./internal/tray -run '^TestNativeTray$' -v -count=1 -timeout 35s` | Wails native tray lifecycle and menu-state updates |
| `YAP_INTEGRATION=1` | `go test ./internal/models -run TestRealWhisper -v -count=1` | Downloads Whisper and Tiny, then transcribes a sample |
| `YAP_FFMPEG_INTEGRATION=1` | `go test ./internal/models -run TestFFmpegDownloadIntegration -v -count=1` | Downloads and verifies the pinned FFmpeg archive |

In PowerShell, set the variable with `$env:YAP_TRAY_SMOKE = '1'` and remove it
afterward with `Remove-Item Env:YAP_TRAY_SMOKE` (substitute the variable you need).
Leave these unset for normal unit tests.

The [Mac notes](macos.md#testing-on-a-mac) list the checks that still need a Mac.
Installer packaging belongs to the separate release setup and is not included here.
