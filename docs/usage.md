# Using Yap

## Recording

The default shortcut is **Ctrl+Alt+Space**. Hold it while speaking and release
Space to transcribe. Settings also has a toggle mode: press once to start and
again to stop. Recordings are limited to ten minutes.

Shortcut recordings request paste into the original app if it still has focus.
If focus has moved or paste is blocked, retrieve the result in Yap and paste it
manually. Yap reports a sent paste request without confirming insertion by the app.
Recording from Yap's microphone button or tray menu copies without pasting.

On Dictate, **Recording options** contains the profile, speech model, and
**Save to history** controls. **History off** stays visible beside it when saving
is disabled. Changing the history preference during recording applies to the next
dictation or import.

Under **Settings → Dictation → Text & delivery**, **Copy automatically to
clipboard** is enabled by default. Turn it off to keep completed
dictation in History without changing the clipboard. Automatic paste also pauses
while copying is off. You can still copy text manually from Home or History.

If transcription succeeds but copying, pasting, or automatic text processing fails,
Yap shows **Transcript ready — action needed**. The warning stays available instead
of disappearing on a timer and directs you to the latest result on Home.
Copying there checks that the result is still current and never pastes into another
app. Cancelled automatic processing leaves the speech transcript available.

Home shows the latest saved or temporary result with **Copy** and **Edit result**.
The inline editor applies changes only when you choose **Apply changes**;
**Cancel** discards the draft and keeps the existing result. Unapplied drafts survive
navigation within the app session: return to Home and reopen **Edit result** to resume
while the same result and revision are current. A draft is not reused for a replacement
result. If the result changes while its editor is open, the draft stays visible but
cannot overwrite the newer result.
Saved edits update History, preserving original recognition and generated outputs.
Temporary edits stay in memory until you choose **Save to History**. A failed initial
History save also keeps recognized text available for explicit saving or copying.
Temporary results expire when a new recording or import starts, on dismissal, or
when Yap exits; a rejected start leaves the previous result available.
**Dismiss** quietly hides either kind of Home result; saved entries stay in History.

The floating indicator appears while you're recording in another app. Drag its
status area to move it; Yap remembers the position. It hides while Yap's main
window has focus. Stop and Cancel are available there and in the tray menu.
Completed dictations offer **Open Yap** to return to the latest result. Save,
copy, paste, and processing warnings stay available in the indicator until you
dismiss them, recover through Home, or start another dictation or import.

The tray menu also opens the **Latest result**, **History**, and **Settings**.
It keeps the last dictation's outcome visible after the indicator disappears.
If a shortcut is unavailable, **Fix shortcuts…** opens the affected shortcut field.
Home also offers **Retry shortcut** and **Change shortcut**; retrying leaves your
saved combination intact. On macOS, grant Accessibility access before retrying.

### Choosing a speech model

Use the **Speech models / Text models** segments at the top of Models to switch
catalogs. The speech catalog opens on **Downloaded** when you already have an installed model. Choose
**All models** to browse the full catalog, or search by model name or language.
Select a model's language count to search its supported languages.
**Help me choose** opens optional language and task guidance; choosing guidance
options does not change your settings. Use **Download & use** or **Use model** to
apply the suggestion, or **Show model** to find it in the catalog. Speed and accuracy
are qualitative guides, and changing models remains an explicit choice.

### Dictation profiles

Under **Settings → Profiles**, choose **New profile** to
start from your saved settings. Name it, then choose its speech model, spoken
language, light cleanup, and optional **After dictation** prompt. Changes save
automatically once a name and model are present. The editor opens inside the
Profiles pane; choose **Back to profiles**, **Done**, or press Escape to return to
the list. Closing Settings also saves valid profile edits; a failed save keeps
the editor open so you can retry or discard the changes.
Choose **Make active** or select it under **Recording options → Profile** on Dictate
to activate it. You can save up to 20 additional profiles and edit or delete them
from Settings. Yap creates and selects **Default** from your setup choices or
existing saved settings.
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
cleanup, or automatic prompt keeps its name selected. On Home, open **Recording
options**, then **Modified** to show the available actions. **Restore saved choices**
reapplies the saved profile; **Update profile…** reviews replacing its four saved
choices; **Save as new…** saves the current choices under a unique name after explicit
submission. Saving a new profile does not
activate it or copy app assignments. Cancel or Escape before submission writes
nothing. Settings keeps its existing modified icon and profile editor.
The speech-model, language, light-cleanup, and **Run after dictation** controls also
show an icon beside their labels when their displayed values differ from the
selected profile. Hover or focus it to see **Changed from [profile name]**, the
profile value, and the current value. Edits that aren't saved yet are identified in
the tooltip. Matching the profile value removes the icon.
Microphone, shortcut, and history changes do not mark it modified. Saved profiles
are kept intact until you update them. You can also select a profile again (or
choose **Make active** in Settings) to restore its saved choices.
Deleting a selected profile keeps your current settings, selects Default, and
marks it modified when those settings differ. Profiles persist locally across app restarts
and are not included in portable backups because they reference this computer's
speech-model paths.

### Settings and drafts

Settings opens as a dialog over your current page. Its search finds controls across
categories; selecting a result opens the category and focuses the matching control.
Close the dialog to return to the page you were using.

Settings save automatically. Toggles and menus save right away; typed fields such
as shortcuts and file paths save when you leave the field or press Enter. If a save
fails, Settings keeps your edit and offers **Retry** or **Discard**. **Error details**
opens a reader for the full failure message. Failed drafts also survive closing and
reopening Settings during the app session. Turning on automatic history deletion
still asks for confirmation first.

Prompts, chains, the text model, and Vocabulary save automatically after a short
pause, including while you type instructions. Valid edits also save when you leave
the page. The status shows progress; invalid drafts pause saving and explain what
needs fixing. Completely empty new vocabulary rows are skipped. Failed saves keep
the draft and offer **Retry** or **Discard changes**. Deleting a prompt or chain
shows an **Undo** action. Background updates preserve edited fields and refresh
untouched settings. Unsaved drafts stay in memory for the current app session;
resolve any save errors before quitting or reloading.

### Automatic profiles and profile cycling

On each card under **Settings → Profiles**, choose **Add app**
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

**Launch at login** and **Start in tray / menu bar** are under **Settings → General → Startup**.
Both are off by default. They apply to packaged builds; development builds stay
visible and don't register for startup. If you move the app, open it from its new
location and turn **Launch at login** off and on again.

## History and vocabulary

History lets you search titles, original and edited text, open a dictation, and copy or
export it. Select entries to export or delete several at once. Deletion moves
dictations to **History → Recently Deleted** immediately, with an **Undo** toast.
Restore them individually or in a selection for 30 days, or choose **Delete
permanently** to remove an entry right away. **Delete selected permanently**
removes a selection. Permanent deletion cannot be undone. Transcripts, edits,
retained audio, and generated outputs stay together during that window. After
30 days, Yap permanently removes them during cleanup, including on its next
launch if it was closed. Recently Deleted is excluded from portable backups.

Use the pencil button on a History row or beside an open dictation's heading to
**Rename dictation**. Enter a title of up to 80 characters and choose **Save title**;
leave it blank to use the transcript preview instead. Titles do not change transcripts
or audio, and are included in exports and backups.

When a text model is enabled and configured, **Generate title** is available as a
sparkle button beside the title input. It uses the saved transcript to suggest a
name. You can cancel generation with the square button, edit the suggestion, or
discard it. The title is saved only when you choose **Save title**.

Turn on **Settings → History & data → Automatically generate titles** to name new
dictations and audio imports saved to History automatically. This is off by
default, applies to every dictation profile, and requires an enabled text model
in **Prompts**. Titles run through the text queue after transcription and automatic
prompts, without delaying clipboard delivery. Existing titles stay unchanged;
you can still rename a dictation manually.

When an entry has retained audio, **Play recording** opens the recording player.
Use its play/pause button, seek bar, playback speed, mute and volume controls.
The seek and volume sliders also support arrow keys, Home and End. The player
stays at the bottom while you scroll. Close it with **Close audio player** to
stop playback; **Play recording** opens it again. Leaving the dictation also
stops playback.

Transcriptions, generated outputs, and processing previews display Markdown,
including headings, emphasis, lists, tables, and code blocks. Edit the Markdown
source in **Edit transcript**. Copy and export keep the source text and formatting
markers so you can reuse them elsewhere.

**Edit transcript** changes the saved result while keeping the original
transcription. It opens an inline editor; **Compare with original** shows a read-only
reference alongside the draft where space allows. Edits save after a short pause;
**Done** or Escape in the text field also saves before closing. Empty text is never
saved. Ctrl/Cmd+Enter saves immediately and keeps the editor open. To reuse a
corrected spelling, select a name or phrase and choose **Add to vocabulary**;
the transcript continues to save automatically.

Vocabulary entries have a preferred spelling and optional aliases. For example,
`postgres` can map to `PostgreSQL`. Matching uses whole words or phrases, not
fuzzy matching. Vocabulary also gives Whisper and Moonshine V2 recognition hints, but it won't
guarantee a particular transcription. The limit is 100 terms, with ten aliases each.

**Light cleanup**, under **Settings → Dictation → Text & delivery**, tidies spacing,
capitalization, punctuation, and common English/German filler words. It uses local
rules and is off by default. It doesn't need a text model or change older transcripts.

## Importing audio

Choose **Import audio** in Dictate or History to select multiple files, or drag
a group of audio files into the Yap window. Supported files are WAV, MP3, M4A,
AAC, FLAC, OGG, Opus, AIFF, and WMA, from 0.3 seconds to 25 minutes long and up
to 256 MiB. Longer files are rejected rather than cut short.

Files enter a backend queue and run one at a time, including while Yap is hidden
in the tray. You can add more files while dictating or importing. The next file
waits for dictation or another operation to finish; an import already running
must finish or be cancelled before you can record. Invalid files appear as failed
rows without stopping the rest of the batch.

The small bottom drawer shows each file's stage. Whisper reports transcription
percentages; decoding, text processing, and speech runtimes without progress use
an indeterminate bar. Drag a queued row by its grip to reorder it, or focus the
grip and use **Alt+ArrowUp/ArrowDown**. Active and finished rows stay pinned.
Remove queued files, cancel the active import, retry failures, or clear finished
rows. **Minimize** (or swipe down) moves the drawer into a bottom-right button;
hover or focus it for status and click to reopen. A minimized queue shows one
summary notification when it finishes.

Imports use your saved speech and text-processing settings when each file starts.
The result goes into History when **Save to history** is enabled, without changing
the source file or clipboard. Each finished row also has a **Copy** action, even
with history off. Results remain available in the queue until you clear them or
quit Yap; the queue itself is not restored after quitting. **Keep recordings**
saves a converted copy for playback and backup.

WAV works without extra software. Other formats need FFmpeg. On Windows x64,
Yap offers to download it once per batch if missing; the first queued file installs
it after you confirm.
You can also install it from Settings → Advanced → Audio support (FFmpeg).
See [Audio support](audio-support.md) for manual setup and download details.

## Local text models

Text processing is optional. Setup introduces it after the speech, microphone,
and shortcut checks. Download a text model and choose **Use model** to enable it,
set context length, and optionally test a response before finishing. **Skip for now**
finishes with dictation only; you can add a text model later in Models.
If you already use LM Studio or Ollama, you can use the models downloaded in that
app instead. Skip this setup step, then select **External server** under
**Prompts → Text model** and connect its local server.

On Windows x64, open **Models → Text models**
to download Gemma 4 E2B, E4B, or 12B. Yap installs a pinned llama.cpp runtime and
verifies downloaded files automatically. The models use Google's instruction-tuned,
QAT four-bit GGUF weights. No LM Studio, Ollama, Python, or separate runtime
installation is required. The initial download needs internet; inference works offline.

In **Prompts → Text model**, select **Yap · built-in models**, choose your downloaded
model, and turn on **Enable text processing**. **Context length** sets the token
space shared by instructions, transcripts, conversation, and replies. Choose
Automatic (a conservative default based on system memory), or an explicit limit
up to the model's maximum. Larger contexts use more working memory. Changes save
automatically and reload the model on its next request.

Yap tries Vulkan GPU acceleration and falls back to CPU if loading fails. The
first request loads the model; it stays available between requests and is unloaded
after two idle minutes. Quitting Yap also stops the worker. A model's **More actions**
menu offers **Verify / repair** and **Remove**. Downloads can be cancelled in
Activity and resumed later; completed chunks are kept until the download is
finished or removed. Switch away from a selected model before removing it.

llama.cpp uses the MIT license and Gemma 4 uses Apache 2.0. License copies are
installed alongside the runtime under the app data folder's `runtime` directory.
Microsoft's C++ runtime libraries are downloaded into that same private directory,
so no system-wide C++ redistributable installation or administrator access is needed.

For an external server, select **External server** in **Prompts → Text model**,
select a server and model, turn on **Enable text
processing**, wait until the changes are saved, and choose **Test model**. The presets
use these base URLs:

| Server       | URL                         |
| ------------ | --------------------------- |
| Ollama       | `http://127.0.0.1:11434/v1` |
| LM Studio    | `http://127.0.0.1:1234/v1`  |
| llama-server | `http://127.0.0.1:8080/v1`  |

Use a loopback URL ending in `/v1`, without `/api` or `/models`. Remote endpoints
and API keys aren't supported. A listed model may still need loading in your
server; **Test model** checks whether it can generate text. You can enter a model
ID manually if the server doesn't list models. Configure context length in the
external server itself.

Cleanup and Summary prompts are included. Select one from the saved prompt library
(or the **Saved prompt** picker in a narrow window). Edit it or add your own; there can
be up to 30 prompts, each with up to 8,000 characters of instructions. The text
is supplied separately, so you don't need placeholders. **Refine prompt** uses
the selected model to suggest clearer instructions. Review and apply the suggestion
if you want to keep it; applied instructions save automatically.

There are three ways to process text:

- The **Outputs** tab on a dictation page saves separate versions using a prompt
  or a saved chain. Choose **New output** if outputs already exist, select an
  **Output prompt**, then choose **Generate** or **Run chain**. A single prompt uses
  the saved transcript. Use the output picker above the text to switch versions;
  **Source & prompt** shows their captured input, instructions, and model details.
  **Regenerate** uses that saved input and prompt with your current model. Opening
  **Edit transcript** leaves generation running. Leaving the dictation page cancels
  an unfinished generation request; completed outputs remain saved.
- **Process text** in the transcript editor previews a result from your draft.
  Choose **Replace draft** to apply the result; it saves automatically.
- **Run after dictation**, inside a prompt's details, runs that prompt before
  copying or pasting new dictations. Only one prompt or chain can run automatically:
  turning another prompt or chain's switch on replaces the current selection, and turning
  the active switch off disables it. The **Automatic** badge marks your selection.
  Prompt edits and the automatic selection save automatically.
  If processing fails or is cancelled, the speech transcript stays
  in History, but nothing is copied or pasted.

### Chat with a transcription

Open a saved transcription and choose **Chat**. It opens a floating pane, like
Activity, without resizing the transcription. Minimize it to reach content behind
it; opening Activity minimizes chat. The source picker in the compact header
chooses the saved or original transcription. Chat uses the local model configured
in **Prompts**. Ask questions, find passages,
or refine a draft with follow-up messages. Enter sends a message; Shift+Enter adds
a new line. **Stop** keeps the interrupted reply, and **Retry reply** tries that
question again. Leaving the transcription stops an unfinished reply; closing just
the chat panel leaves it running.

Use the microphone icon to record a message with your configured local speech
model. Choose **Transcribe voice message** to place it in the composer, where you
can edit it before sending. Existing typed text is preserved. The discard icon,
minimizing chat, or leaving the page cancels a voice recording. Voice input does
not create a History entry, paste text elsewhere, or retain its audio. Recordings
stop automatically after two minutes.

New replies use the latest saved transcription by default. **Source for new
replies** also offers the original recognition. Each turn keeps its source
snapshot, so editing the transcript does not change earlier answers or their
references. Click a passage reference to scroll to and highlight its source text.
Changed or ambiguous passages are flagged instead of highlighting different text.
Select a passage in the transcription and choose **Ask about selection** to attach
it to your next message. Saved outputs offer **Discuss in chat** in their actions.

**Copy reply** copies an answer without citation markers. **Save as output** keeps
it in Outputs with clickable source references. The references keep their source
snapshot even after clearing chat and are included in backups. Older chat Outputs
with numbered citation markers also support references. Continue in chat to refine these outputs rather than regenerating
them from a saved prompt. **Review rewrite** shows a comparison before applying
a reply. A selected-passage rewrite preserves the surrounding text; other rewrites
replace the saved transcription. Finish an open transcript edit before applying
a chat rewrite. The original transcription and revision history are preserved.

Conversations save locally with their transcriptions and are included in backups.
Undoing a transcription deletion restores its chat; permanent deletion removes
both. **Clear chat** removes the conversation while keeping the transcription and
saved outputs. Older conversation context is summarized automatically for the
model while the full visible conversation remains saved. The transcript itself
is supplied in full: if it exceeds the model's context window, use a larger
context window or a shorter transcript.

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

To run a chain manually, open a dictation's **Outputs** tab, choose **New output**
if the composer is closed, then choose the chain in the prompt picker and select
**Run chain**. To run it automatically, turn on
**Run chain after dictation** in its details, or choose it under **After dictation**
in a dictation profile. All steps use the shared local text model. Automatic
execution copies or pastes only the last step after the entire chain succeeds.

Each completed step is saved immediately as a separate output with its chain,
step number, exact input, prompt, and model. A failed or cancelled step stops the
chain and keeps completed results. With **Save to history** off, results remain
temporary on Home; select its **Outputs** tab to inspect or copy completed steps.
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
actions, the Vocabulary header, or **Tools → Version history** in the transcript
editor. Select a version to preview it, then choose **Restore version** to
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

## Performance statistics

Enable **Settings → Advanced → Performance statistics** to show a stats icon button
on the latest Home result and in a dictation's History header. For a generated
output, expand **Source & prompt** to find it. Select the icon to open performance
details in a dialog.
The setting is off by default.

New dictations retain transcription time, speech engine, model, audio length,
and the language setting. Transcription speed compares audio length with elapsed
transcription time, including model loading and excluding audio preparation.
Generated outputs retain LLM request time, retries, and any token counts returned
by the local server. Response rate is output tokens divided by the final request's
elapsed time; server-reported generation speed is shown separately when available.
Token counts describe the final response, while LLM time includes retries.

These details are collected locally with new results, even while their display
is off, and follow those results into History and exported backups. Temporary
results keep stats only in memory until explicitly saved. Older results and
servers that omit metrics show those values as unavailable.

## Storage and backups

Yap stores its database, models, runtimes, and recordings in the OS user
configuration folder: `%APPDATA%\yap` on Windows or
`~/Library/Application Support/yap` on macOS.

Audio retention is off by default. History retention defaults to **Keep forever**;
you can choose 7, 30, or 90 days under **Settings → History & data → History retention**.
Cleanup runs when you save that setting, start Yap, finish a dictation, and hourly while Yap
is running. This policy permanently removes expired active entries; manually
deleted dictations keep their separate 30-day recovery window. Turning retention
off doesn't recover entries already removed by the policy, so export anything
you want to keep first.

In Models, switch away from a model before removing it. Yap only removes managed
downloads, not custom files. **Repair & use** replaces a damaged model;
**Check & repair runtime** checks the managed Windows runtime.

**Settings → History & data → Backup & restore** exports a `.yap-backup.zip` with
history, titles, edited text, generated outputs, prompts, chains, vocabulary, and
portable preferences.
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
  **Settings → Advanced → Setup → Run setup** lets you repeat the microphone and
  shortcut checks.
- **Transcription fails:** run **Dictation diagnostics** under Settings → Advanced.
  It records a short test and shows runtime errors without saving to History or
  changing the clipboard. Technical details can help with a bug report.
- **Paste doesn't work:** check History and the clipboard. Yap won't switch
  focus back to another app to paste. On a Mac, check Accessibility permission.
- **The interface fails to load:** try the recovery screen's retry or reload
  action. Quit and reopen Yap if it reports a backend version mismatch. During
  development, restart `wails3 dev`. Unsaved drafts may be lost on reload.

Error reports stay in memory until you choose to copy them. Check what you're
sharing before posting a report, and leave out private transcripts or recordings.
