#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  printf '%s\n' 'Run this script on macOS. Wails 2 requires the native macOS SDK and CGO.' >&2
  exit 1
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
# FFmpeg's out-of-tree configure/make does not support whitespace in paths.
if [[ "$project_root" == *[[:space:]]* ]]; then
  printf '%s\n' 'Build from a checkout path without spaces (required by FFmpeg).' >&2
  exit 1
fi
for tool in go npm node cmake make xcrun curl shasum ditto codesign otool plutil tar sysctl; do
  if ! command -v "$tool" >/dev/null 2>&1; then printf 'Missing tool: %s. See docs/macos.md.\n' "$tool" >&2; exit 1; fi
done
xcrun --find clang >/dev/null
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Use Node 22.12 or newer."); process.exit(1); }'
case "$(go env GOVERSION)" in
  go1.26.*) ;;
  *) printf '%s\n' 'Use the project-tested Go 1.26.x toolchain. See docs/macos.md.' >&2; exit 1 ;;
esac

target="${1:-universal}"
case "$target" in
  universal) architectures=(arm64 x86_64) ;;
  arm64) architectures=(arm64) ;;
  amd64) architectures=(x86_64) ;;
  *) printf '%s\n' 'Usage: bash scripts/build-macos.sh [universal|arm64|amd64]' >&2; exit 1 ;;
esac

identity="${CODESIGN_IDENTITY:--}"
if [[ -n "${NOTARY_PROFILE:-}" && "$identity" == - ]]; then
  printf '%s\n' 'Notarization requires CODESIGN_IDENTITY (Developer ID Application).' >&2
  exit 1
fi

export CGO_ENABLED=1
export MACOSX_DEPLOYMENT_TARGET=13.3
export CGO_CFLAGS="${CGO_CFLAGS:-} -mmacosx-version-min=13.3"
export CGO_LDFLAGS="${CGO_LDFLAGS:-} -mmacosx-version-min=13.3"
work="$project_root/build/macos-work"
mkdir -p "$work" "$project_root/build/bin"
source_archive="$work/whisper-v1.9.2.tar.gz"
source_sha=a6abd064fcca8b85e794d205abf328c522e9451db43a3eadc178b883b7d0e9cd
if [[ ! -f "$source_archive" ]]; then
  curl --fail --location --retry 3 'https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v1.9.2' -o "$source_archive.download"
  mv "$source_archive.download" "$source_archive"
fi
printf '%s  %s\n' "$source_sha" "$source_archive" | shasum -a 256 -c -
tar -xzf "$source_archive" -C "$work"
source_dir="$work/whisper.cpp-1.9.2"

# Keep FFmpeg independent of the builder's Homebrew libraries. The unmodified
# source archive and this build recipe travel with the app for redistribution.
ffmpeg_version=9.0.2
ffmpeg_archive="$work/ffmpeg-$ffmpeg_version.tar.xz"
ffmpeg_sha=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
if [[ ! -f "$ffmpeg_archive" ]]; then
  curl --fail --location --retry 3 "https://ffmpeg.org/releases/ffmpeg-$ffmpeg_version.tar.xz" -o "$ffmpeg_archive.download"
  mv "$ffmpeg_archive.download" "$ffmpeg_archive"
fi
printf '%s  %s\n' "$ffmpeg_sha" "$ffmpeg_archive" | shasum -a 256 -c -
tar -xf "$ffmpeg_archive" -C "$work"
ffmpeg_source="$work/ffmpeg-$ffmpeg_version"
jobs="$(sysctl -n hw.ncpu)"

# Build each runtime slice separately: GGML selects architecture-specific CPU
# kernels at configure time. Combine complete binaries only after linking.
runtime_slices=()
ffmpeg_slices=()
for architecture in "${architectures[@]}"; do
  runtime_build="$work/whisper-$architecture"
  cmake -S "$source_dir" -B "$runtime_build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=13.3 \
    -DCMAKE_OSX_ARCHITECTURES="$architecture" \
    -DBUILD_SHARED_LIBS=OFF -DGGML_BACKEND_DL=OFF -DGGML_NATIVE=OFF \
    -DGGML_AVX2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_BMI2=OFF \
    -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_OPENMP=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
  cmake --build "$runtime_build" --config Release --target whisper-cli --parallel
  runtime_slices+=("$runtime_build/bin/whisper-cli")

  ffmpeg_build="$work/ffmpeg-$ffmpeg_version-$architecture"
  mkdir -p "$ffmpeg_build"
  ffmpeg_arch="$architecture"
  if [[ "$architecture" == arm64 ]]; then ffmpeg_arch=aarch64; fi
  (
    cd "$ffmpeg_build"
    "$ffmpeg_source/configure" \
      --arch="$ffmpeg_arch" --target-os=darwin --enable-cross-compile \
      --cc="$(xcrun --find clang)" \
      --extra-cflags="-arch $architecture -mmacosx-version-min=13.3" \
      --extra-ldflags="-arch $architecture -mmacosx-version-min=13.3" \
      --disable-autodetect --disable-shared --enable-static \
      --disable-gpl --disable-nonfree --disable-version3 \
      --disable-doc --disable-debug --disable-ffplay --disable-ffprobe \
      --disable-network --disable-devices --disable-hwaccels --disable-x86asm \
      --disable-encoders --enable-encoder=pcm_s16le,flac,aac \
      --disable-muxers --enable-muxer=pcm_s16le,wav,flac,adts,ipod \
      --disable-protocols --enable-protocol=file,pipe
    make -j "$jobs" ffmpeg
  )
  ffmpeg_slices+=("$ffmpeg_build/ffmpeg")
done

# Use the project-pinned CLI without requiring a globally installed Wails.
go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0 build -platform "darwin/$target" -o Yap -trimpath
app="$project_root/build/bin/yap.app"
runtime_dir="$app/Contents/Resources/whisper"
ffmpeg_dir="$app/Contents/Resources/ffmpeg"
mkdir -p "$runtime_dir" "$ffmpeg_dir"
if [[ "$target" == universal ]]; then
  xcrun lipo -create "${runtime_slices[@]}" -output "$runtime_dir/whisper-cli"
  xcrun lipo -create "${ffmpeg_slices[@]}" -output "$ffmpeg_dir/ffmpeg"
else
  cp "${runtime_slices[0]}" "$runtime_dir/whisper-cli"
  cp "${ffmpeg_slices[0]}" "$ffmpeg_dir/ffmpeg"
fi
chmod 755 "$runtime_dir/whisper-cli" "$ffmpeg_dir/ffmpeg"
cp "$source_dir/LICENSE" "$runtime_dir/LICENSE"
cp "$ffmpeg_source/COPYING.LGPLv2.1" "$ffmpeg_source/LICENSE.md" "$ffmpeg_dir/"
cp "$ffmpeg_archive" "$ffmpeg_dir/"
cp scripts/build-macos.sh "$ffmpeg_dir/build-macos.sh"
for architecture in "${architectures[@]}"; do
  cp "$work/ffmpeg-$ffmpeg_version-$architecture/ffbuild/config.mak" "$ffmpeg_dir/config-$architecture.mak"
done
cat > "$ffmpeg_dir/YAP-SOURCE-NOTICE.txt" <<EOF
FFmpeg $ffmpeg_version, copyright the FFmpeg developers (https://ffmpeg.org/).
LGPL version 2.1 or later; GPL, nonfree and version3 components are disabled.
Yap invokes the standalone executable; no FFmpeg code is linked into Yap.
The FFmpeg libraries are statically linked into that separate executable.
Unmodified corresponding source: ffmpeg-$ffmpeg_version.tar.xz (included here).
Upstream: https://ffmpeg.org/releases/ffmpeg-$ffmpeg_version.tar.xz
SHA-256: $ffmpeg_sha
Build recipe: build-macos.sh, FFmpeg configure/make section.
Per-architecture configuration: config-*.mak. No external codec libraries.
To rebuild FFmpeg alone, extract the archive and run that section on macOS
with Xcode Command Line Tools. Configure in a separate build directory.
You may replace ffmpeg with a compatible modified executable. Modifying a
signed bundle requires re-signing the modified executable and app for local use.
License: COPYING.LGPLv2.1 and LICENSE.md. See https://ffmpeg.org/legal.html.
EOF

# Refuse a package that would depend on the builder's Homebrew installation.
for executable in "$app/Contents/MacOS/Yap" "$runtime_dir/whisper-cli" "$ffmpeg_dir/ffmpeg"; do
  for architecture in "${architectures[@]}"; do xcrun lipo -verify_arch "$architecture" "$executable"; done
  dependencies="$(otool -arch all -L "$executable")"
  if printf '%s\n' "$dependencies" | awk '/^[ \t]+/ {print $1}' | grep -Ev '^(/System/Library/|/usr/lib/)' >/dev/null; then
    printf 'Non-system dynamic dependency in %s\n' "$executable" >&2
    printf '%s\n' "$dependencies" >&2
    exit 1
  fi
done
plutil -lint "$app/Contents/Info.plist" build/darwin/entitlements.plist
go test ./...
go vet ./...
(cd frontend && npm run typecheck)

sign_options=(--force --sign "$identity")
if [[ "$identity" != - ]]; then sign_options+=(--options runtime --timestamp); fi
codesign "${sign_options[@]}" "$runtime_dir/whisper-cli"
codesign "${sign_options[@]}" "$ffmpeg_dir/ffmpeg"
codesign "${sign_options[@]}" --entitlements build/darwin/entitlements.plist "$app"
codesign --verify --strict "$runtime_dir/whisper-cli"
codesign --verify --strict "$ffmpeg_dir/ffmpeg"
codesign --verify --deep --strict "$app"

# Exercise the host architecture before producing a distributable archive.
bash scripts/smoke-macos.sh "$app"

version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
archive="$project_root/build/bin/Yap-$version-macos-$target.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$archive" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$app"
  xcrun stapler validate "$app"
  ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
fi
(cd "$(dirname "$archive")" && shasum -a 256 "$(basename "$archive")" > "$(basename "$archive").sha256")
printf '\nBuilt %s\nArchive: %s\n' "$app" "$archive"
if [[ "$identity" == - ]]; then printf '%s\n' 'Ad hoc signed for local testing. Public distribution needs Developer ID signing and notarization.'; fi
