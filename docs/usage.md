# Using Yap

## Recording

The default shortcut is **Ctrl+Alt+Space**. Hold it while speaking and release
Space to transcribe. Settings also has a toggle mode: press once to start and
again to stop. Recordings are limited to ten minutes.

Shortcut recordings paste into the original app if it still has focus. If focus
has moved or paste is blocked, the text stays in History and on the clipboard.
Recording from Yap's microphone button or tray menu copies without pasting.

The floating indicator appears while you're recording in another app. Stop and Cancel are available there and in the tray menu.

### Microphone and shortcut

Choose a microphone under **Settings → Audio input**, then save. **System
default** follows your OS setting. If a selected microphone is unplugged, Yap
asks you to reconnect it or choose another one.

Enter a shortcut in Settings and save it.
Supported combinations use Ctrl, Alt, or Shift with Space, A–Z, or F1–F12.
Windows/Command and AltGr aren't supported. If another app has claimed the
shortcut, choose another; the microphone button still works.

### Running in the background

Closing the window hides Yap to the tray or Mac menu bar. Use **Open Yap** to
bring it back and **Quit Yap** to exit.

## History

History lets you search, copy, export, and delete recent transcripts.
Deleting a transcript also removes its retained audio.

## Storage

Yap stores its database, models, runtimes, and recordings in the OS user
configuration folder: `%APPDATA%\yap` on Windows or
`~/Library/Application Support/yap` on macOS.

Audio retention is off by default. Transcripts stay in History until you delete them.

## When something goes wrong

- **No microphone input:** check OS permission and the input device.
- **Paste doesn't work:** check History and the clipboard. Yap won't switch
  focus back to another app to paste. On a Mac, check Accessibility permission.
