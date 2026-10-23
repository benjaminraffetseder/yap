# Using Yap

## Recording

The default shortcut is **Ctrl+Alt+Space**. Hold it while speaking and release
Space to transcribe. Settings also has a toggle mode: press once to start and
again to stop. Recordings are limited to ten minutes.

Shortcut recordings paste into the original app if it still has focus. If focus
has moved or paste is blocked, the text stays in History and on the clipboard.
Recording from Yap's microphone button or tray menu copies without pasting.

Under **Settings → Dictation → Text & delivery**, **Copy automatically to
clipboard** is enabled by default. Turn it off to keep completed
dictation in History without changing the clipboard. Automatic paste also pauses
while copying is off. You can still copy text manually from History.

If transcription succeeds but copying, pasting, or automatic text processing fails,
Yap shows **Transcript ready — action needed**. The warning stays available instead
of disappearing on a timer, with a **Copy transcript** action. Failed copying can be retried from the same
notification. Cancelled automatic processing also leaves the speech transcript
available to copy. Copying from this notification never pastes into another app.

The floating indicator appears while you're recording in another app. Drag its
status area to move it; Yap remembers the position. It hides while Yap's main
window has focus. Stop and Cancel are available there and in the tray menu.

### Dictation profiles

Under **Settings → Dictation → Dictation profiles**, choose **New profile** to
start from your saved settings. Name it, then choose its speech model, spoken
language, light cleanup, and optional **After dictation** prompt. Changes save
automatically once a name and model are present; choose **Done** to close the editor.
Choose **Use** or select it in the **Profile** menu on Dictate to activate it. You can save
up to 20 additional profiles and edit or delete them from Settings. Yap creates
and selects **Default** from your setup choices or existing saved settings.
Default stays available and can be edited, but cannot be renamed or deleted.

Saving a profile does not activate it. Switching applies all its choices together
and keeps your microphone, shortcut, delivery, history, and startup preferences.
Profiles apply to new recordings and audio imports. Switching is blocked while
an operation is running. A missing speech model, incompatible Moonshine language,
disabled text model, or deleted prompt must be resolved before using that profile;
failed switches leave the previous settings in place.

Automatic prompts use the shared local text model configured in Prompts. A profile
with **No automatic processing** clears the automatic prompt while keeping that
model available for manual use. Changing a profile's speech model, language,
cleanup, or automatic prompt in Settings keeps its name selected and adds a small
modified icon. Hover or focus the profile name or icon to see **Modified**.
The speech-model, language, light-cleanup, and **Run after dictation** controls also
show an icon beside their labels when their displayed values differ from the
selected profile. Hover or focus it to see **Changed from [profile name]**, the
profile value, and the current value. Edits that aren't saved yet are identified in
the tooltip. Matching the profile value removes the icon.
Microphone, shortcut, and history changes do not mark it modified. Saved profiles
are kept intact; edit and save the profile to keep your new choices, or select it
again (or choose **Use** in Settings) to restore its saved choices.
Deleting a selected profile keeps your current settings, selects Default, and
marks it modified when those settings differ. Profiles persist locally across app restarts
and are not included in portable backups because they reference this computer's
speech-model paths.

Settings save automatically. Toggles and menus save right away; typed fields such
as shortcuts and file paths save when you leave the field or press Enter. If a save
fails, Settings keeps your edit and offers **Retry** or **Discard changes**. Turning on
automatic history deletion still asks for confirmation first.

Prompts, chains, the text model, and Vocabulary save automatically after a short
pause, including while you type instructions. Valid edits also save when you leave
the page. The status shows progress; invalid drafts pause saving and explain what
needs fixing. Completely empty new vocabulary rows are skipped. Failed saves keep
the draft and offer **Retry** or **Discard changes**. Deleting a prompt or chain
shows an **Undo** action. Background updates preserve edited fields and refresh
untouched settings. Unsaved drafts stay in memory for the current app session;
resolve any save errors before quitting or reloading.

### Automatic profiles and profile cycling

On each card under **Settings → Dictation → Dictation profiles**, choose **Add app**
and pick an open application. Assigned apps appear as badges on the card and save
immediately; select a badge's remove button to unassign it. Each app belongs to one
profile, and picking an app that another profile uses moves it. Open the target app
first if it isn't listed. Windows rules identify the executable name; macOS rules
identify its bundle ID. Rules cover the entire application, including every tab in a
browser. Automatic app identification requires Windows or a native macOS build.

When you start dictation with the global recording shortcut, Yap uses the focused
app's profile for that recording. The profile name appears in Dictate and the
floating indicator while recording. Moving focus afterwards doesn't change it.
Apps without a rule, audio imports, and recordings started in Yap or the tray use
your manually selected settings. Automatic selection leaves those saved settings
in place. If a matching profile's model or prompt is unavailable, Yap reports the
problem before recording; repair the profile or remove its rule. Deleting a
profile also removes its app rules. Vocabulary remains shared across profiles.

Set an optional **Cycle profiles shortcut**, such as `Ctrl+Alt+P`, under
**Settings → Dictation → Shortcuts**. It must differ from the recording shortcut; leave it empty to disable
it. Each press selects the next available profile in library order, skipping
profiles with unavailable models or prompts, and shows its name in the floating
indicator. In an assigned app, cycling starts from that app's profile. Your choice
overrides its rule for the next shortcut dictation in the same app; subsequent
dictations use the rule again. Starting dictation in another app clears that
temporary override. Cycling is paused during recording, processing, and shortcut
capture. If another program claims the shortcut, Yap keeps your previous setting
and reports the conflict. App rules and the cycling shortcut stay local to this
computer and aren't included in portable backups.

### Microphone and shortcut

Choose a microphone under **Settings → Dictation → Recording**. **System
default** follows your OS setting. If a selected microphone is unplugged, Yap
asks you to reconnect it or choose another one.

Use **Record shortcut** under **Settings → Dictation → Shortcuts**, then choose
**Use shortcut**.
Supported combinations use Ctrl, Alt, or Shift with Space, A–Z, or F1–F12.
Windows/Command and AltGr aren't supported. If another app has claimed the
shortcut, choose another; the microphone button still works.

### Running in the background

Closing the window hides Yap to the tray or Mac menu bar. Use **Open Yap** to
bring it back and **Quit Yap** to exit.

**Launch at login** and **Start in tray / menu bar** are under Settings → Startup.
Both are off by default. They apply to packaged builds; development builds stay
visible and don't register for startup. If you move the app, open it from its new
location and turn **Launch at login** off and on again.

## History and vocabulary

History lets you search original and edited text, open a dictation, and copy or
export it. Select entries to export or delete several at once. Deletion moves
dictations to **History → Recently Deleted** immediately, with an **Undo** toast.
Restore them individually or in a selection for 30 days, or choose **Delete
permanently** to remove an entry right away. **Delete selected permanently**
removes a selection. Permanent deletion cannot be undone. Transcripts, edits,
retained audio, and generated outputs stay together during that window. After
30 days, Yap permanently removes them during cleanup, including on its next
launch if it was closed. Recently Deleted is excluded from portable backups.

Transcriptions, generated outputs, and processing previews display Markdown,
including headings, emphasis, lists, tables, and code blocks. Edit the Markdown
source in **Edit transcript**. Copy and export keep the source text and formatting
markers so you can reuse them elsewhere.

**Edit transcript** changes the saved result while keeping the original
transcription. Edits save after a short pause; **Done** and Escape also save before
closing. Empty text is never saved. Ctrl/Cmd+Enter saves immediately and keeps the
editor open. To reuse a corrected spelling, select a name or phrase and choose
**Add to vocabulary**; the transcript continues to save automatically.

Vocabulary entries have a preferred spelling and optional aliases. For example,
`postgres` can map to `PostgreSQL`. Matching uses whole words or phrases, not
fuzzy matching. Vocabulary also gives Whisper and Moonshine V2 recognition hints, but it won't
guarantee a particular transcription. The limit is 100 terms, with ten aliases each.

**Light cleanup**, under Settings → Text processing, tidies spacing, capitalization,
punctuation, and common English/German filler words. It uses local rules and is
off by default. It doesn't need a text model or change older transcripts.

## Importing audio

Choose **Import audio** in Dictate or History, or drag one audio file into the
Yap window. Supported files are WAV, MP3, M4A,
AAC, FLAC, OGG, Opus, AIFF, and WMA, from 0.3 seconds to 25 minutes long and up
to 256 MiB. Longer files are rejected rather than cut short.

Imports use your saved speech and text-processing settings. The result goes into
History without changing the source file or clipboard. **Keep recordings** saves
a converted copy for playback and backup.

WAV works without extra software. Other formats need FFmpeg. On Windows x64,
Yap offers to download it if missing; nothing downloads until you confirm.
You can also install it from Settings → Advanced → Audio support (FFmpeg).
See [Audio support](audio-support.md) for manual setup and download details.

## Local text models

Text processing is optional. It needs a running model server on your computer;
Yap doesn't install the server or load a GGUF file itself.

In **Prompts → Text model**, select a server and model, enable LLM processing, wait
until the changes are saved, and choose **Test model**. The presets use these base URLs:

| Server | URL |
| --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| llama-server | `http://127.0.0.1:8080/v1` |

Use a loopback URL ending in `/v1`, without `/api` or `/models`. Remote endpoints
and API keys aren't supported. A listed model may still need loading in your
server; **Test model** checks whether it can generate text. You can enter a model
ID manually if the server doesn't list models.

Cleanup and Summary prompts are included. Select one from the saved prompt library
(or the **Saved prompt** picker in a narrow window). Edit it or add your own; there can
be up to 30 prompts, each with up to 8,000 characters of instructions. The text
is supplied separately, so you don't need placeholders. **Refine prompt** uses
the selected model to suggest clearer instructions. Review and apply the suggestion
if you want to keep it; applied instructions save automatically.

There are three ways to process text:

- **Generated outputs** on a dictation page saves separate versions using a prompt
  or a saved chain. A single prompt uses the saved transcript. Each output keeps
  its input, instructions, and model details.
  **Regenerate** uses that saved input and prompt with your current model.
- **Process text** in the transcript editor previews a result from your draft.
  Choose **Replace draft** to apply the result; it saves automatically.
- **Run after dictation**, inside a prompt's details, runs that prompt before
  copying or pasting new dictations. Only one prompt or chain can run automatically:
  turning another prompt or chain's switch on replaces the current selection, and turning
  the active switch off disables it. The **Automatic** badge marks your selection.
  Prompt edits and the automatic selection save automatically.
  If processing fails or is cancelled, the speech transcript stays
  in History, but nothing is copied or pasted.

### Prompt chains

Open **Prompts → Chains → Add chain**, give it a name, then select **Add step**
and choose a saved prompt. For each step, choose **Use text from**:

- **Original transcription** uses the speech recognizer's unedited text.
- **Saved transcript** uses the transcript captured when the
  run starts, including light cleanup, vocabulary replacements, and saved edits.
- **Step N: Prompt name** uses the result of that particular earlier step.

New steps default to the preceding step's result. For example, Cleanup can use
the original, Summary can use Cleanup, and Email can use either Summary or
Cleanup. Only earlier steps are available as inputs. Reordering preserves those
references; moves that would put an input after its dependent are disabled.
Open a step's actions menu to move or remove it. Change dependent inputs before
removing a step. Valid chain changes save automatically.
There can be up to 30 chains, each containing 1–10 steps.

To run a chain manually, open a dictation's **Outputs** tab, choose the chain in
the prompt picker, and select **Run chain**. To run it automatically, turn on
**Run chain after dictation** in its details, or choose it under **After dictation**
in a dictation profile. All steps use the shared local text model. Automatic
execution copies or pastes only the last step after the entire chain succeeds.

Each completed step is saved immediately as a separate output with its chain,
step number, exact input, prompt, and model. A failed or cancelled step stops the
chain and keeps completed results. With **Save to history** off, results remain
temporary on Home; expand **Completed chain steps** to inspect or copy them.
**Save to history** saves the transcript and all completed steps together.

Regenerating an individual output creates a separate version from its captured
input and instructions; existing downstream outputs keep their original inputs.
Editing or deleting a chain does not change past outputs. Prompts used by a
chain must be removed from its steps before they can be deleted. Backups include
saved chains and the input relationships of their generated outputs.

Each prompt execution starts with a 4,096-token output budget. If the reply hits
that budget, Yap retries the same input with a larger budget, up to 32,768 tokens.
Partial replies are never saved. Each prompt or chain step, including retries,
times out after five minutes; prompt refinement does not use these retries.
If the server reports stopping below the requested budget, Yap stops retrying.
Long input and output must still fit your model's context window. If truncation
persists, increase the context window or output limit in your local server, use a
model with a larger context window, or process a shorter passage. Saved outputs
remain available when text processing is disabled.

### Version history

Open **Version history** from a prompt's **More prompt actions** menu, a chain's
actions, the Vocabulary header, or the transcript editor beside **Original** and
**Changes**. Select a version to preview it, then choose **Restore version** to
load it into the draft. Restored content saves automatically. Transcript and prompt
previews also show a text comparison. A chain cannot be restored if one of its
steps refers to a prompt that no longer exists.

History is tracked separately for each prompt, chain, and transcript, and for the
whole vocabulary list. The first change preserves the prior content. Saves within
a ten-minute editing window are grouped, with up to 50 versions kept per item.
Restoring preserves the version you restored from, so you can undo a restore.
The original transcription remains available separately. Transcript versions stay
with dictations in Recently Deleted and are removed on permanent deletion.
Version history stays on this computer and is excluded from portable backups.

## Storage and backups

Yap stores its database, models, runtimes, and recordings in the OS user
configuration folder: `%APPDATA%\yap` on Windows or
`~/Library/Application Support/yap` on macOS.

Audio retention is off by default. History retention defaults to **Keep forever**;
you can choose 7, 30, or 90 days under Settings → History & storage. Cleanup runs
when you save that setting, start Yap, finish a dictation, and hourly while Yap
is running. This policy permanently removes expired active entries; manually
deleted dictations keep their separate 30-day recovery window. Turning retention
off doesn't recover entries already removed by the policy, so export anything
you want to keep first.

In Models, switch away from a model before removing it. Yap only removes managed
downloads, not custom files. **Repair & use** replaces a damaged model;
**Check & repair runtime** checks the managed Windows runtime.

Settings → Backup & restore exports a `.yap-backup.zip` with history, edited
text, generated outputs, prompts, chains, vocabulary, and portable preferences.
**Include retained recordings** is off by default. Models and runtimes aren't
included. Save backups outside Yap's data folder and keep them private: they
are unencrypted.

Restore shows a preview and merges new entries into your library. Existing IDs
and conflicting local entries keep their contents; skipped items are counted.
**Restore portable preferences** is optional. Microphone, shortcut, runtime
paths, startup, retention, and text-server settings stay specific to this computer.
Backups wait until pending settings edits finish saving.

## When something goes wrong

- **No microphone input:** check OS permission and the saved input device.
  **Settings → Run setup** lets you repeat the microphone and shortcut checks.
- **Transcription fails:** run **Dictation diagnostics** under Settings → Advanced.
  It records a short test and shows runtime errors without saving to History or
  changing the clipboard. Technical details can help with a bug report.
- **Paste doesn't work:** check History and the clipboard. Yap won't switch
  focus back to another app to paste. On a Mac, check Accessibility permission.
- **The interface fails to load:** try the recovery screen's retry or reload
  action. Quit and reopen Yap if it reports a backend version mismatch. During
  development, restart `wails dev`. Unsaved drafts may be lost on reload.

Error reports stay in memory until you choose to copy them. Check what you're
sharing before posting a report, and leave out private transcripts or recordings.
