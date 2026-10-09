#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then printf '%s\n' 'Run this smoke test on macOS.' >&2; exit 1; fi
project_root="$(cd "$(dirname "$0")/.." && pwd)"
app="${1:-$project_root/build/bin/yap.app}"
cli="$app/Contents/Resources/whisper/whisper-cli"
ffmpeg="$app/Contents/Resources/ffmpeg/ffmpeg"
if [[ ! -x "$cli" || ! -x "$ffmpeg" ]]; then printf '%s\n' 'Build yap.app first with bash scripts/build-macos.sh.' >&2; exit 1; fi
"$cli" --help >/dev/null 2>&1
"$ffmpeg" -version
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/yap-whisper-smoke.XXXXXX")"
# This directory is created solely by this test and contains no user data.
trap 'rm -rf "$test_dir"' EXIT
curl --fail --location --retry 3 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin' -o "$test_dir/ggml-tiny.bin"
printf '%s  %s\n' be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21 "$test_dir/ggml-tiny.bin" | shasum -a 256 -c -
curl --fail --location --retry 3 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.2/samples/jfk.wav' -o "$test_dir/jfk.wav"
printf '%s  %s\n' 59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e "$test_dir/jfk.wav" | shasum -a 256 -c -
"$cli" -m "$test_dir/ggml-tiny.bin" -f "$test_dir/jfk.wav" -l en -otxt -of "$test_dir/transcript" -nt -np
grep -qi country "$test_dir/transcript.txt"
cat "$test_dir/transcript.txt"

# Exercise compression, resampling, and the raw PCM output used by Yap imports.
# FLAC and M4A use only the native encoders enabled in our FFmpeg build.
for format in flac m4a; do
  codec=flac
  demuxer=flac
  if [[ "$format" == m4a ]]; then codec=aac; demuxer=mov; fi
  "$ffmpeg" -hide_banner -loglevel error -nostdin -i "$test_dir/jfk.wav" \
    -ar 48000 -ac 2 -c:a "$codec" "$test_dir/input.$format"
  "$ffmpeg" -hide_banner -loglevel error -nostdin -xerror \
    -protocol_whitelist file,pipe -f "$demuxer" -i "$test_dir/input.$format" \
    -map 0:a:0 -vn -sn -dn -ac 1 -ar 16000 -c:a pcm_s16le -f s16le \
    pipe:1 > "$test_dir/decoded.pcm"
  test -s "$test_dir/decoded.pcm"
  "$ffmpeg" -hide_banner -loglevel error -nostdin -y -f s16le -ar 16000 -ac 1 \
    -i "$test_dir/decoded.pcm" -c:a pcm_s16le "$test_dir/decoded.wav"
  "$cli" -m "$test_dir/ggml-tiny.bin" -f "$test_dir/decoded.wav" -l en \
    -otxt -of "$test_dir/transcript-$format" -nt -np
  grep -qi country "$test_dir/transcript-$format.txt"
done
printf '\nBundled Whisper and FFmpeg smoke tests passed on %s.\n' "$(uname -m)"
