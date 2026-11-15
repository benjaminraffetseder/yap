# Development

Yap has a Go backend and a React 19/TypeScript frontend, connected by Wails v3.
The UI uses Tailwind v4 and shadcn/ui with Base UI components.

TypeScript is kept on 6.0.x while the latest `typescript-eslint` requires
TypeScript below 6.1. Upgrade both together when TypeScript 7 support is available.

Playwright stays pinned to 1.62.1. The bundled Chromium versions in Playwright
1.63.0, 1.64.1, and 1.65.0 leave notification timers paused after keyboard focus
returns to the page in the microphone-error test. Recheck that scenario before
upgrading the test runner.

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

| Path                 | Purpose                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `main.go`            | Window setup and app entry point                                            |
| `app*.go`            | Recording state and methods exposed to the frontend                         |
| `internal/audio`     | Capture, decoding, and WAV import                                           |
| `internal/platform`  | Global shortcuts and text insertion                                         |
| `internal/tray`      | Wails v3 system tray menu and recording-state adapter                       |
| `internal/indicator` | Frameless Wails indicator, presentation and platform focus/geometry helpers |
| `internal/startup`   | Existing launch-at-login registrations                                      |
| `internal/inference` | Whisper CLI and local text-server clients                                   |
| `internal/models`    | Model/runtime downloads and verification                                    |
| `internal/storage`   | SQLite, history, retention, and backups                                     |
| `frontend/src`       | Domain features, shared UI, hooks, and bridge helpers                       |
| `build`              | Wails icons, native manifests, and version metadata                         |

The [frontend code map](../frontend/src/README.md) lists domain ownership and
shared folders. Components and hooks for a product area live together under
`frontend/src/features/<domain>`; cross-domain UI and hooks have shared folders.

Keep platform-specific code in the existing `_windows`, `_darwin`, and `_other`
files with matching build tags. Bound Go structs use camelCase JSON fields.
Wails generates `frontend/bindings`; don't edit it by hand.

The main UI and floating indicator are separate Vite entry points. Keep the
indicator in `frontend/src/features/indicator/components/indicator.tsx`, mounted by
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

TanStack Query owns fetched History lists (including all loaded pages), session
details, generated outputs, saved chat, Home results, and saved configuration,
vocabulary, and model catalogs. `backend.ts` remains the
promise-based Wails transport. Native queries and mutations use `networkMode:
"always"`; internet connectivity never pauses local Go calls. Reads and writes
do not automatically retry, and window focus/reconnect do not refetch. Saved
resources stay fresh until invalidated and remain cached for 30 minutes after
navigation. Home instead discards its cache when unmounted and reads on return.
Query Devtools are available in the main app's development builds. The launcher
is excluded from `ui-test` mode to keep it out of notification hit targets, and
the devtools are excluded from production builds.

Saved data has three query boundaries. `GetConfiguration` reads settings, text
processing (including prompts/chains), profiles, active/default/modified state,
automation rules, the profile shortcut, and derived speech readiness under one Go
lock. Profile application therefore publishes one coherent baseline.
`GetVocabulary` preserves editable legacy conflicts and normalizes alias arrays.
`GetModelCatalog` returns speech/text catalogs, installed metadata, runtime support,
and recommended context. These getters read effective native memory/files without
querying History or the database connection held by a backup. `GetSnapshot` remains
an additive compatibility API, assembled from the same helpers; the main frontend
uses `GetRuntimeSnapshot` for runtime synchronization instead.

`useSavedActions` runs existing persisted writes as Query mutations. It cancels
older saved reads before a write and refreshes the affected query domains after
settlement, including failures that might follow partial persistence. Responses
are receipts, never replacements for cached configuration. Refresh failures stay
visible through the query error and explicit recovery; side effects never retry
automatically. Draft baselines come from Query, while `useSavedDraft` retains edits
and reconciles acknowledged fields against the latest baseline. A successful write
whose follow-up read fails retains its submitted draft across navigation until a
fresh saved baseline arrives; later edits must not restore stale saved fields.
Confirmed autosaves refresh through the error-reporting command boundary, so a
failed read cannot turn a successful write into a save failure. Cached saved-read
errors retain a notification with **Retry loading**; it retries reads without
replaying writes and closes once those reads recover.

The main app's Wails listeners invalidate resources directly on
`dictation:history`, session-specific `chat:changed`, and `setup:changed` (including
backup restores). Do not infer invalidation from `snapshot.history` identity:
older sessions can change outside that snapshot subset. Native saved writes attach optional query domains to `setup:changed`:
`configuration` for settings/History preference (including tray changes), text
configuration and profiles/automation; `vocabulary` for vocabulary writes; and
`catalogs` for text model completion/removal and speech model removal. Speech model
completion, cancellation and failures refresh configuration and catalogs, including
partially installed files. Unscoped setup events cover setup diagnostics and backup
restore and invalidate all saved/session resources. Scoped events do not refetch
unrelated saved resources. Mutation settlement also reads current data because
native events can precede a write's response or be absent after an error.
Cancelling a query discards obsolete replies, but does not stop native inference;
text-generation and chat request owners must still cancel by request ID.

`DictationProvider` composes separate contexts for commands, connection state,
runtime metadata, status, phase, queues, updater state and panel controls.
`useDictationRuntime` owns native events and runtime synchronization, including
the existing request and revision guards. `useAppUpdateState` owns updater
requests/events. Commands and context values retain stable references when their
domain does not change.

Consumers use the focused hooks in `frontend/src/features/dictation/hooks/use-dictation-state.ts`:
`useDictationActions` for commands, `useDictationPhase` for phase-only guards,
`useDictationActivity` for operation identity/errors without progress, and
`useDictationStatus` when the message, transcript or progress is needed. Import
and text queues subscribe separately. Saved configuration/catalog/vocabulary
hooks read Query directly; they keep no additional saved copy. The broad
`useDictationState` and `useDictation` interfaces remain compatibility wrappers;
application components use the focused hooks instead.

Audio levels have their own provider/subscription and are read inside small meter
components in Home, setup and diagnostics. Queue rows and command-only components
do not subscribe to audio. Browser render-count regressions verify that progress,
queue and audio events leave unrelated consumers idle while operation errors
still reach their readers. Live recording, inference, cancellation and streaming
retain their native/request owners. Interface language remains local.
Queue roots are memoized so the activity pane's native-progress updates do not
rerender either queue through their parent; their own queue contexts still update
them. A browser call-count regression covers the actual queue components.

This stage is reversible: the older full snapshot and all existing setters remain
available, and no database/schema or persisted format changed. Reverting the
frontend migration can use that snapshot; scoped event payloads remain compatible
with listeners that ignore their data.
Home commands still validate the current result revision in Go and explicitly
read after actions; accepted capture expires temporary cached text too.

`DraftProvider` keeps unsaved edits in memory across navigation. Home result edits
require **Apply changes**; the History transcript editor saves automatically.
Home drafts belong to a session ID and result revision: preserve a draft when
returning to the same result, and do not apply it to a replacement result. Cancel
discards the Home draft; a successful Apply must leave it clean.

Keep output-generation requests mounted while the inline transcript editor is
open. Hiding the detail tabs preserves their request owner; unmounting it cancels
the request. Copy confirmation must also belong to the text version that started
the request, so a late reply cannot confirm a different tab's text.

## Validation and form ownership

Frontend domain schemas use Zod and live in the owning feature's `lib` folder.
Shared rules and the compatibility adapters for existing editors live in
`frontend/src/lib/validation`. The adapters preserve existing first-error/row-error
messages, while schemas expose field paths for forms. Preserve Go's byte limits,
Unicode character limits and duplicate folding. Schemas validate drafts without
normalizing them; native payload conversion stays separate. Native Go validation
remains authoritative.

React Hook Form owns fields and submission state in explicit-submit forms, with
`zodResolver` sharing the domain validation. `CorrectionForm` is the first example;
it retains native-write error recovery, stale-selection guards and IME handling.
Use shared Field primitives for accessible errors, `register` for native inputs
and `Controller` for controlled Base UI controls. Saved writes still use Query
actions. Autosaved editors retain `useSavedDraft`/`useAutoSave` so drafts survive
navigation and reconcile with saved changes through one owner.

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

For an optional chat smoke test against a running local model server, set
`YAP_CHAT_ENDPOINT` to its loopback `/v1` URL and `YAP_CHAT_MODEL` to a loaded model
ID, then run `go test . -run '^TestChatLiveLocalModel$' -v -count=1` from the repo
root. It uses synthetic history in a temporary database to check source updates,
passage references, and conversation compaction without changing app settings.

To smoke-test a built-in Gemma model on Windows x64, set `YAP_GEMMA_INTEGRATION`
to `gemma-4-e2b`, `gemma-4-e4b`, or `gemma-4-12b`, then run
`go test ./internal/inference/text -run '^TestManagedGemmaIntegration$' -v -count=1 -timeout 20m`.
It downloads the pinned runtime and model into temporary storage, verifies hashes,
and checks completion, streaming chat, and context-length reloads. The model
downloads are several GB; normal tests use a small real child-process fixture.
Set `YAP_TEXT_RUNTIME_INTEGRATION=1` and run
`go test ./internal/models -run '^TestTextRuntimeDownloadIntegration$' -v -count=1`
to validate the runtime packages and app-local C++ libraries without model downloads.

Native and download tests are opt-in. Run them from the repo root on Windows:

| Environment variable       | Command                                                                    | What it exercises                                                                                       |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `YAP_INDICATOR_SMOKE=1`    | `go test ./internal/indicator -run '^TestNativeIndicator' -v -count=1`     | Build the frontend first; real Wails window, controls, focus, dragging and saved geometry on Windows    |
| `YAP_SHUTDOWN_SMOKE=1`     | `go test . -run '^TestNativeShutdown$' -v -count=1 -timeout 15s`           | Wails quits while a worker holds the app mutex and awaits the UI thread, without changing the clipboard |
| `YAP_TRAY_SMOKE=1`         | `go test ./internal/tray -run '^TestNativeTray$' -v -count=1 -timeout 35s` | Wails native tray lifecycle and menu-state updates                                                      |
| `YAP_INTEGRATION=1`        | `go test ./internal/models -run TestRealWhisper -v -count=1`               | Downloads Whisper and Tiny, then transcribes a sample                                                   |
| `YAP_FFMPEG_INTEGRATION=1` | `go test ./internal/models -run TestFFmpegDownloadIntegration -v -count=1` | Downloads and verifies the pinned FFmpeg archive                                                        |

In PowerShell, set the variable with `$env:YAP_TRAY_SMOKE = '1'` and remove it
afterward with `Remove-Item Env:YAP_TRAY_SMOKE` (substitute the variable you need).
Leave these unset for normal unit tests.

The [Mac notes](macos.md#testing-on-a-mac) list the checks that still need a Mac.
Installer packaging belongs to the separate release setup and is not included here.
