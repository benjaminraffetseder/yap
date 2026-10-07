# Development

Yap has a Go backend and a React 19/TypeScript frontend, connected by Wails v2.
The UI uses Tailwind v4 and shadcn/ui with Base UI components.

## Running locally

See the [README](../README.md#build-from-source) for tool versions. From the repo
root, run `wails dev` and leave the terminal open. It rebuilds Go changes and
serves the frontend with Vite. Ctrl+C stops the watcher; closing the app window
only hides it to the tray.

Run one dev session per checkout. If port 5173 is occupied, stop the previous
Vite process before starting another. Restart `wails dev` if the frontend reports
that its backend bindings are out of date.

For frontend work in a browser, first run `wails build` to generate bindings:

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
| `internal/indicator`, `internal/tray`, `internal/startup` | Native desktop controls |
| `internal/inference` | Whisper CLI and local text-server clients |
| `internal/models` | Model/runtime downloads and verification |
| `internal/storage` | SQLite, history, retention, and backups |
| `frontend/src` | Pages, components, and bridge helpers |
| `build` | Wails icons, native manifests, and version metadata |

Keep platform-specific code in the existing `_windows`, `_darwin`, and `_other`
files with matching build tags. Bound Go structs use camelCase JSON fields.
Wails generates `frontend/wailsjs`; don't edit it by hand.

The local hotkey dependency has a small event-ordering patch. Keep the `replace`
in `go.mod`; [the patch notes](../third_party/hotkey/README.md) explain why.

To add a UI component, run `npm run ui:add -- <component>` from `frontend`.
Use the existing Base UI components and theme rather than introducing another
component library.

## Build files

The tracked files in `build/` are inputs to Wails: the icons, Windows manifest
and version metadata, and macOS plists and entitlements. Keep them in the repo;
`wails build` uses them directly. The Mac plists include the microphone permission
description and minimum OS version.

Generated output under `build/bin`, Wails-generated installer files, and local
release tooling are ignored. `scripts/` contains only local release helpers and
isn't needed for `wails dev` or `wails build`. No installer or signing tools are
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

The browser tests mock the desktop bridge and use a separate Vite cache, so they
can run alongside `wails dev`.

Native and download tests are opt-in. Run them from the repo root on Windows:

| Environment variable | Command | What it exercises |
| --- | --- | --- |
| `YAP_INDICATOR_SMOKE=1` | `go test ./internal/indicator -run '^TestNativeIndicator' -v -count=1` | Real floating windows, focus, and dragging |
| `YAP_TRAY_SMOKE=1` | `go test ./internal/tray -run TestNativeTray -v -count=1` | Real tray controls |
| `YAP_INTEGRATION=1` | `go test ./internal/models -run TestRealWhisper -v -count=1` | Downloads Whisper and Tiny, then transcribes a sample |

In PowerShell, set the variable with `$env:YAP_TRAY_SMOKE = '1'` and remove it
afterward with `Remove-Item Env:YAP_TRAY_SMOKE` (substitute the variable you need).
Leave these unset for normal unit tests.

The [Mac notes](macos.md#testing-on-a-mac) list the checks that still need a Mac.
Installer packaging belongs to the separate release setup and is not included here.
