# Using Yap

## Recording

The default shortcut is **Ctrl+Alt+Space**. Hold it while speaking and release
Space to transcribe. Settings also has a toggle mode: press once to start and
again to stop. Recordings are limited to ten minutes.

Shortcut recordings paste into the original app if it still has focus. If focus
has moved or paste is blocked, the text stays in History and on the clipboard.
Recording from Yap's microphone button or tray menu copies without pasting.

The floating indicator appears while you're recording in another app. Drag its
status area to move it; Yap remembers the position. It hides while Yap's main
window has focus. Stop and Cancel are available there and in the tray menu.

### Microphone and shortcut

Choose a microphone under **Settings → Audio input**, then save. **System
default** follows your OS setting. If a selected microphone is unplugged, Yap
asks you to reconnect it or choose another one.

Use **Record shortcut** in Settings, then choose **Use shortcut** and save.
Supported combinations use Ctrl, Alt, or Shift with Space, A–Z, or F1–F12.
Windows/Command and AltGr aren't supported. If another app has claimed the
shortcut, choose another; the microphone button still works.

### Running in the background

Closing the window hides Yap to the tray or Mac menu bar. Use **Open Yap** to
bring it back and **Quit Yap** to exit.

**Launch at login** and **Start in tray / menu bar** are under Settings → Startup.
Both are off by default and need a settings save. They apply to packaged builds;
development builds stay visible and don't register for startup. If you move the
app, open it from its new location and save the startup setting again.

## History and vocabulary

History lets you search original and edited text, open a dictation, and copy or
export it. Select entries to export or delete several at once. Deleting an entry
also deletes its retained audio and generated outputs.

**Edit transcript** changes the saved result while keeping the original
transcription. Ctrl/Cmd+Enter saves; Escape cancels. To reuse a corrected spelling,
select a name or phrase and choose **Add to vocabulary**. Save the transcript
separately if you also want to keep the edit.

Vocabulary entries have a preferred spelling and optional aliases. For example,
`postgres` can map to `PostgreSQL`. Matching uses whole words or phrases, not
fuzzy matching. Vocabulary also gives Whisper recognition hints, but it won't
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

In **Prompts**, select a server and model, enable LLM processing, save, and choose
**Test model**. The presets use these base URLs:

| Server | URL |
| --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| llama-server | `http://127.0.0.1:8080/v1` |

Use a loopback URL ending in `/v1`, without `/api` or `/models`. Remote endpoints
and API keys aren't supported. A listed model may still need loading in your
server; **Test model** checks whether it can generate text. You can enter a model
ID manually if the server doesn't list models.

Cleanup and Summary prompts are included. Edit them or add your own; there can
be up to 30 prompts, each with up to 8,000 characters of instructions. The text
is supplied separately, so you don't need placeholders. **Refine prompt** uses
the selected model to suggest clearer instructions. Review and save the suggestion
if you want to keep it.

There are three ways to process text:

- **Generated outputs** on a dictation page saves separate versions using its
  saved text. Each output keeps its input, instructions, and model details.
  **Regenerate** uses that saved input and prompt with your current model.
- **Process text** in the transcript editor previews a result from your draft.
  Choose **Replace draft**, then **Save transcript** to keep it.
- **After dictation** runs a chosen prompt before copying or pasting new
  dictations. If processing fails or is cancelled, the speech transcript stays
  in History, but nothing is copied or pasted.

Requests time out after five minutes. Long input may exceed your model's context
window; try a shorter passage if it fails. Saved outputs remain available when
text processing is disabled.

## Storage and backups

Yap stores its database, models, runtimes, and recordings in the OS user
configuration folder: `%APPDATA%\yap` on Windows or
`~/Library/Application Support/yap` on macOS.

Audio retention is off by default. History retention defaults to **Keep forever**;
you can choose 7, 30, or 90 days under Settings → History & storage. Cleanup runs
when you save that setting, start Yap, and finish a dictation. Turning it off
doesn't recover deleted entries, so export anything you want to keep first.

In Models, switch away from a model before removing it. Yap only removes managed
downloads, not custom files. **Repair & use** replaces a damaged model;
**Check & repair runtime** checks the managed Windows runtime.

Settings → Backup & restore exports a `.yap-backup.zip` with history, edited
text, generated outputs, prompts, vocabulary, and portable preferences.
**Include retained recordings** is off by default. Models and runtimes aren't
included. Save backups outside Yap's data folder and keep them private: they
are unencrypted.

Restore shows a preview and merges new entries into your library. Existing IDs
and conflicting local entries keep their contents; skipped items are counted.
**Restore portable preferences** is optional. Microphone, shortcut, runtime
paths, startup, retention, and text-server settings stay specific to this computer.
Save any pending settings edits before starting a backup or restore.

## When something goes wrong

- **No microphone input:** check OS permission and the saved input device.
  **Settings → Run setup** lets you repeat the microphone and shortcut checks.
- **Transcription fails:** save your settings, then run **Dictation diagnostics**.
  It records a short test and shows runtime errors without saving to History or
  changing the clipboard. Technical details can help with a bug report.
- **Paste doesn't work:** check History and the clipboard. Yap won't switch
  focus back to another app to paste. On a Mac, check Accessibility permission.
- **The interface fails to load:** try the recovery screen's retry or reload
  action. Quit and reopen Yap if it reports a backend version mismatch. During
  development, restart `wails dev`. Unsaved drafts may be lost on reload.

Error reports stay in memory until you choose to copy them. Check what you're
sharing before posting a report, and leave out private transcripts or recordings.
