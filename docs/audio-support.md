# Audio support

Yap imports PCM WAV files without FFmpeg. Microphone recording on Windows and
macOS also works without it; Linux microphone recording uses FFmpeg. Importing
MP3, M4A, AAC, FLAC, OGG, Opus, AIFF, or WMA needs a local FFmpeg executable.
Conversion runs on your computer.

## Installing FFmpeg

On Windows x64, choose **Download audio support** when importing a file, or open
**Settings → Advanced → Audio support (FFmpeg)**. Yap asks before downloading
the 73.0 MiB archive, checks its size and SHA-256, and installs it in its own
data folder. It doesn't change PATH or need administrator access.

Progress and Cancel are available in Settings, Dictate, and History. If the
download started from an import, that import continues afterward. If you cancel
or something fails, select the file again to retry. A completed installation
stays available even if you cancel the subsequent import.

You can also supply FFmpeg yourself. On Windows, an executable beside Yap or on
PATH takes precedence over the managed copy. On a Mac, Yap checks its bundled
copy first, then PATH and the usual Homebrew locations; see
[Mac setup](macos.md#optional-audio-formats).
On Linux, Yap uses the system FFmpeg installation.

## Linux audio

The Debian package declares FFmpeg and PulseAudio tools as dependencies, so apt
installs them along with Yap. For a source or standalone build on Debian/Ubuntu:

```sh
sudo apt install ffmpeg pulseaudio-utils
```

Microphone capture uses PulseAudio; PipeWire works through its PulseAudio
compatibility service. `pactl` lists available microphones. FFmpeg also decodes
imported files other than PCM WAV. See [Linux setup](linux.md#build-and-run).

## The Mac bundle

`bash scripts/build-macos.sh` builds FFmpeg 9.1 from its pinned upstream source
and includes it at `Contents/Resources/ffmpeg/ffmpeg`. This standalone executable
uses LGPL v2.1 or later, with GPL/nonfree/version3 components disabled and no
external codec libraries. Yap runs it as a separate process. The bundle contains
the exact source archive, licence texts, build script, source notice, and each
architecture's configuration. Keep these files when distributing the app.
The source SHA-256 is
`1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433`.

The build enables local-file audio decoding and PCM output for Yap. FLAC and
AAC encoding are included for the packaging smoke test. It is not a general
FFmpeg installation for network inputs or arbitrary output formats. A plain
`wails3 build` does not run this packaging step.

## The Windows download

The pinned build is defined in [`internal/models/ffmpeg.go`](../internal/models/ffmpeg.go).

| Field | Value |
| --- | --- |
| Provider | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) |
| Release | [autobuild-2026-10-31-12-59](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59) |
| Package | `ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-shared-9.0.zip` |
| Size | 76,576,818 bytes (73.0 MiB) |
| SHA-256 | `e907b01fa4783913151237e37df2a10fa97d99a1598a021bf59d4ae62ffed4c0` |
| FFmpeg source | [`7adfbe40dcde598f93a6963d2f7b22cd75202ccc`](https://github.com/FFmpeg/FFmpeg/tree/7adfbe40dcde598f93a6963d2f7b22cd75202ccc) |
| Build scripts and dependency sources | [`5031c6f1082414e53688d39e521849905071070d`](https://github.com/BtbN/FFmpeg-Builds/tree/5031c6f1082414e53688d39e521849905071070d) |

This is an **LGPL v3 or later** shared build, with neither GPL nor nonfree
components enabled. The extracted package keeps its upstream license and docs.
Yap adds `COPYING.GPLv3` and `YAP-SOURCE-NOTICE.txt`, which records the exact
source and build links. It runs FFmpeg as a separate process; the DLLs remain
replaceable. The installation lives at
`<Yap data>/runtime/<package>/bin/ffmpeg.exe`.

## Updating the download

Update the constants and required DLL names in `internal/models/ffmpeg.go`, the
embedded `ffmpeg-notice.txt`, and the table above together. Check the archive's
actual size and hash, run `ffmpeg -L` and `ffmpeg -buildconf`, and confirm the
source links match that build. Keep a fixed release URL rather than `latest`.

The pin uses a retained month-end release. Check that it's still available when
preparing a Yap release. If you mirror or distribute FFmpeg binaries yourself,
check [FFmpeg's licensing guidance](https://ffmpeg.org/legal.html) and include
the corresponding source and dependency materials; links alone aren't a source
mirror.

Unit tests use local fixtures. To test the real download on Windows x64:

```powershell
$env:YAP_FFMPEG_INTEGRATION = '1'
go test ./internal/models -run TestFFmpegDownloadIntegration -v -count=1
Remove-Item Env:YAP_FFMPEG_INTEGRATION
```
