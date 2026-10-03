# Audio support

Recording and WAV import work without extra software. MP3, M4A, AAC, FLAC,
OGG, Opus, AIFF, and WMA import need a local FFmpeg executable.

On Windows, place ffmpeg.exe beside Yap or add it to PATH. On a Mac, Yap also
checks /opt/homebrew/bin/ffmpeg and /usr/local/bin/ffmpeg for Homebrew installs.
Reopen Yap after installing. Conversion runs locally and leaves the source file
unchanged. Missing FFmpeg doesn't prevent recording or WAV import.
