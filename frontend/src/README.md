# Frontend code map

Start in `features/<domain>` when looking for product behavior. A domain keeps its
components, hooks, helpers, and routed pages together. Only create the subfolders
that the domain needs.

```text
src/
  app.tsx                 Main app composition, providers, and routes
  main.tsx                Main window entry point
  indicator.tsx           Floating indicator entry point
  features/
    <domain>/
      components/         Domain UI
      hooks/              Domain state and native request hooks
      lib/                Domain helpers, Zod schemas, and data transformations
      pages/              Route-level screens and coordinators
  components/
    layout/               App shell, command menu, and fallback screens
    shared/               Reusable presentation, forms, and theme components
    ui/                   Shared shadcn/Base UI primitives
  hooks/                  Shared autosave, draft, and motion hooks
  lib/
    backend.ts            Typed Wails transport and native data contracts
    queries/              Query client, keys, defaults, and saved-resource hooks
    validation/           Shared validation primitives and editor adapters
    desktop.ts            Native host detection
    languages.ts          Shared language data and localized labels
    motion.ts             Shared animation tokens
    utils.ts              Shared utility helpers
  i18n/                   Translation setup, catalogs, and native message labels
  assets/                 Shared static assets
```

## Domains

| Folder                 | Responsibility                                                             |
| ---------------------- | -------------------------------------------------------------------------- |
| `features/audio`       | Import controls, playback, and FFmpeg support                              |
| `features/backup`      | Backup export, preview, and restore                                        |
| `features/chat`        | Transcription chat, voice input, citations, and source references          |
| `features/dictation`   | Recording, shortcuts, diagnostics, and runtime contexts/events             |
| `features/history`     | History lists, search, selection, deletion, and session pages              |
| `features/home`        | Home page and the latest-result surface                                    |
| `features/indicator`   | Independent floating recording/status window                               |
| `features/models`      | Speech/text model catalogs, settings, guidance, and discovery              |
| `features/processing`  | Activity pane, import/text queues, and output generation                   |
| `features/profiles`    | Dictation profiles, app rules, and profile setting indicators              |
| `features/prompts`     | Saved prompt and chain editors                                             |
| `features/settings`    | Settings page and composition of domain panels                             |
| `features/setup`       | Setup flow and readiness checks                                            |
| `features/transcripts` | Shared transcript editing, corrections, diff, revisions, export, and stats |
| `features/updates`     | App updater panel and native update state                                  |
| `features/vocabulary`  | Vocabulary editor                                                          |

The History session page composes transcript, chat, audio, and processing
components. Settings and setup similarly compose other domains; those reusable
pieces stay with the domain that owns their behavior.

## Placement and imports

- Put a component or hook beside its owning domain, even if another screen uses
  it. Promote it to a shared folder when it has no domain-specific behavior.
- Use `components/ui` for primitives and `components/shared` for reusable app
  presentation. The existing shadcn aliases still point at these UI primitives.
- Import domain files directly, for example
  `@/features/models/components/model-card` or
  `@/features/chat/hooks/use-chat-voice`. Local sibling imports are also fine.
  Avoid adding barrel files just to shorten paths.
- Keep Wails calls and transport contracts in `lib/backend.ts`, and common Query
  ownership in `lib/queries`. Folder organization does not change data ownership.
- Use the focused runtime hooks in
  `features/dictation/hooks/use-dictation-state.ts` for commands, phase/status,
  queues, and controls. The native synchronization hook lives beside them.
- Keep the floating indicator independent of main-window providers and effects.
  Its entry point imports only the indicator domain and its shared dependencies.

Browser fixtures and regressions remain in `frontend/tests`. Generated Wails
bindings remain in `frontend/bindings` and are not edited manually.

## Validation and forms

Keep domain Zod schemas in the owning feature's `lib` folder. Shared text and
identifier rules live in `lib/validation/primitives.ts`; `draft-validation.ts`
adapts schemas to the existing first-error and row-error interfaces. Schemas
validate raw drafts without trimming or coercing them. Keep native payload
conversion separate, and preserve the Go validators' limits and Unicode rules.
Go remains responsible for validating every native write.

Use React Hook Form with `zodResolver` for forms submitted as a unit. The
transcript correction dialog is the first example: its form owns field values,
validation and submission state, while saved writes use the existing Query
actions. Use the shared Field primitives for labels and accessible errors;
register native inputs and use Controller for controlled Base UI inputs.

Autosaved settings, prompts, profiles and vocabulary continue to use
`useSavedDraft` and `useAutoSave`. These hooks own navigation-persistent drafts
and reconciliation with saved data. Keep that ownership when adding form
controls rather than introducing a second copy of the same draft.
