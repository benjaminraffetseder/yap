# Audio support

Yap records from the microphone and imports WAV files without FFmpeg. Importing
MP3, M4A, AAC, FLAC, OGG, Opus, AIFF, or WMA needs a local FFmpeg executable.
Conversion runs on your computer.

## Installing FFmpeg

On Windows x64, choose **Download audio support** when importing a file, or open
**Settings → Advanced → Audio support (FFmpeg)**. Yap asks before downloading
the 73.4 MiB archive, checks its size and SHA-256, and installs it in its own
data folder. It doesn't change PATH or need administrator access.

Progress and Cancel are available in Settings, Dictate, and History. If the
download started from an import, that import continues afterward. If you cancel
or something fails, select the file again to retry. A completed installation
stays available even if you cancel the subsequent import.

You can also supply FFmpeg yourself. On Windows, an executable beside Yap or on
PATH takes precedence over the managed copy. On a Mac, Yap checks its bundled
copy first, then PATH and the usual Homebrew locations; see
[Mac setup](macos.md#optional-audio-formats).
Other platforms require manual installation.

## The Mac bundle

`bash scripts/build-macos.sh` builds FFmpeg 9.0.2 from its pinned upstream source
and includes it at `Contents/Resources/ffmpeg/ffmpeg`. This standalone executable
uses LGPL v2.1 or later, with GPL/nonfree/version3 components disabled and no
external codec libraries. Yap runs it as a separate process. The bundle contains
the exact source archive, licence texts, build script, source notice, and each
architecture's configuration. Keep these files when distributing the app.
The source SHA-256 is
`8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`.

The build enables local-file audio decoding and PCM output for Yap. FLAC and
AAC encoding are included for the packaging smoke test. It is not a general
FFmpeg installation for network inputs or arbitrary output formats. A plain
`wails build` does not run this packaging step.

## The Windows download

The pinned build is defined in [`internal/models/ffmpeg.go`](../internal/models/ffmpeg.go).

| Field | Value |
| --- | --- |
| Provider | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) |
| Release | [autobuild-2026-09-30-13-08](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08) |
| Package | `ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-shared-9.0.zip` |
| Size | 76,972,461 bytes (73.4 MiB) |
| SHA-256 | `7157177b8a6cb2174c1650ba8c71b363f2c78cba5330f88c4c02cf5b2b880646` |
| FFmpeg source | [`2a571b606854520cf89804d8030c8b328e621689`](https://github.com/FFmpeg/FFmpeg/tree/2a571b606854520cf89804d8030c8b328e621689) |
| Build scripts and dependency sources | [`6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b`](https://github.com/BtbN/FFmpeg-Builds/tree/6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b) |

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
