# Wails v3 app updates

Yap uses `app.Updater` from the pinned Wails v3.1.0 dependency. The built-in
GitHub provider performs release discovery and version comparison; Wails owns
download progress, SHA-256 verification, staging, the update window, atomic
replacement, and restart. See the [Wails updater guide](https://wails.io/guides/updater/)
and [self-update tutorial](https://wails.io/tutorials/04-self-update-a-wails-app/).

Yap retains a small adapter for quiet daily startup checks, cached display
status, and its existing Settings and command-menu actions. Checks never
download application binaries. Installation requires an explicit user action,
and restart requires **Restart & Apply**. Wails invokes the existing shutdown
hook so audio workers, storage, shortcuts, and native resources are cleaned up
before the helper replaces the executable.

## Publish a release

The public repository defaults to `benjaminraffetseder/yap`. To change it, build
with `wails3 build LDFLAGS="-X main.updateRepository=owner/yap-releases"`.
An empty repository disables updates. Never embed a GitHub token in the app.

1. Update `info.version` in `build/config.yml`, `build/windows/info.json`,
   `build/windows/wails.exe.manifest`, and both `build/darwin/Info*.plist` files.
   The embedded version and executable metadata must match the stable release
   tag, for example `0.11.0` and `v0.11.0`. `go test ./...` checks the metadata.
2. Build and sign the final application. On Windows use `wails3 build ARCH=amd64`,
   then your existing Authenticode signing process. Run
   `wails3 task windows:update:asset` **after signing**. This copies the final
   executable to `build/bin/yap-0.11.0-windows-amd64.exe` and creates
   `build/bin/SHA256SUMS` without rebuilding or changing the signature.
   A custom source/output can be supplied to `scripts/prepare-update.ps1`.
3. On macOS use `scripts/build-macos.sh` with Developer ID signing and
   notarization as described in [macOS packaging](macos.md). It produces
   `Yap-0.11.0-macos-universal.zip` (or `arm64` / `amd64`), containing the complete
   `yap.app`, bundled Whisper, and FFmpeg, plus `SHA256SUMS`. The ZIP has exactly
   one top-level app; `__MACOSX` resource sidecars are omitted for Wails extraction.
4. Create a draft release tagged `v0.11.0`. Upload the application artifacts and
   a **single** `SHA256SUMS` containing every uploaded update artifact's entry.
   If built on separate machines, combine their checksum lines. Prepare helpers
   include matching artifacts already in their output directory; they do not
   merge checksum files from other machines. Each line has the form
   `<64 hexadecimal SHA-256 characters>  <exact asset filename>`, without a BOM.
5. Include release notes and publish the stable release as latest only after
   every artifact and checksum is uploaded. Drafts and prereleases are not used.

Windows updates select only `yap-<version>-windows-amd64.exe`. A `-setup.exe`,
installer, archive of a Windows installation directory, or checksum sidecar
cannot be selected as the executable. The Windows updater replaces only Yap;
it retains existing companion files, and managed speech tools/models remain in
the data directory. If a release needs installer-managed prerequisites changed,
distribute that change through the installer rather than relying on this swap.

macOS selects the matching architecture-specific `Yap-<version>-macos-*.zip`,
falling back to the universal bundle. Other platforms currently have no updater
artifact contract. macOS bundles must be installed in a writable location.

Yap requires the selected artifact to have a full SHA-256 entry. Wails treats
missing GitHub checksum sidecars as optional, so the provider adapter rejects
missing, malformed, or incomplete entries before offering an update. A digest
mismatch leaves the running app unchanged. These digests verify integrity;
they do not provide an independent signing trust root if the release repository
is compromised. No updater signing key is configured. Authenticode and macOS
code signing remain part of the release process. Adding updater signatures
requires a signature-capable provider and a pinned public key; the built-in
GitHub provider does not fetch detached signatures.

## Compatibility and rollback

Keep `yap-<version>-windows-amd64-setup.exe` on transition releases alongside the
raw executable. Older Yap versions still discover and open that installer in a
browser; installing it once moves them onto the Wails updater. New Yap versions
ignore installer assets. Do not remove installers while older clients need them.

`update-check.json` remains in Yap's data directory and now holds the attempt
time and display status, scoped to the repository and installed version. Legacy
installer cache entries are ignored. Cached status is never used for installation:
Wails rechecks the provider on **Install update**. No newer release, including a
GitHub 404, follows Wails' up-to-date behavior. Offline failures retain the last
known notice and do not interrupt dictation. The Settings preview remains plain
text capped at 8000 UTF-8 bytes; the Wails window renders the full release notes.

No settings, database, history, recordings, downloaded models, or application
identity are migrated. Roll back by quitting Yap and reinstalling a previous
installer or macOS bundle. The old updater can recreate its cache. Wails keeps
a rollback copy during its swap and validates the replacement before discarding
that copy; helper diagnostics are written to `wails-update-<pid>.log` in the
system temporary directory.

## Release smoke test

Test two packaged versions against a controlled public release before rollout:

- Check and stage the newer build. Verify that a checksum mismatch or missing
  asset leaves the old app running and reports an error.
- Close the updater window after staging, reopen Settings, and use **Restart &
  Apply**. Confirm the new build launches, keeps its settings/history/models,
  registers shortcuts once, and reports the new version.
- Exercise restart while audio work is active and verify normal shutdown.
- On macOS, test both Intel and Apple Silicon and confirm bundled tools and
  notarization survive the bundle replacement. On Windows, test your actual
  installer location and permissions as a standard user.

Automated tests cover the real Wails GitHub provider, checksums and staging,
daily throttling, legacy-cache handling, cancellation and concurrency, and the
frontend actions. They do not replace the native swap/relaunch smoke test.
