import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useDictation } from "@/components/dictation-provider";
import { backend, isBusy, isDesktop, message, type AudioSupport } from "@/lib/backend";

export function AudioSupportPanel({
  active,
  disabled = false,
}: {
  active: boolean;
  disabled?: boolean;
}) {
  const { snapshot, run } = useDictation();
  const [support, setSupport] = useState<AudioSupport | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const { status } = snapshot;
  const downloading = status.phase === "downloading";
  const busy = isBusy(status.phase);
  const refresh = useCallback(async () => {
    if (!isDesktop) return;
    const id = ++request.current;
    setChecking(true);
    setError("");
    try {
      const value = await backend.audioSupport();
      if (id === request.current) setSupport(value);
    } catch (cause) {
      if (id === request.current) {
        setSupport(null);
        setError(message(cause));
      }
    } finally {
      if (id === request.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    return () => {
      request.current++;
    };
  }, [active, status.phase, refresh]);
  async function install() {
    setPending(true);
    setError("");
    try {
      await backend.installAudioSupport();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-labelledby="audio-support-title" className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="audio-support-title" className="text-sm font-semibold">
          Audio support (FFmpeg)
        </h2>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh audio support"
          disabled={!isDesktop || checking || busy || pending}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" className={`size-4 ${checking ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="space-y-4 px-5 py-4">
        <p className="text-xs leading-5 text-muted-foreground">
          FFmpeg enables MP3, M4A, AAC, FLAC, OGG, Opus, AIFF, and WMA imports. Recording and WAV
          import work without it.
        </p>
        {!isDesktop ? (
          <p className="text-sm text-muted-foreground">
            Open Yap on your desktop to manage audio support.
          </p>
        ) : (
          <>
            {checking && (
              <p role="status" className="text-sm text-muted-foreground">
                Checking audio support…
              </p>
            )}
            {support && (
              <div className="space-y-2">
                <p role="status" className="text-sm">
                  {support.message}
                </p>
                {support.path && (
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {support.path}
                  </p>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {support &&
              !support.installed &&
              (support.canDownload ? (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    disabled={disabled || busy || pending || checking}
                    onClick={() => void install()}
                  >
                    <Download aria-hidden="true" className="size-4" />
                    Download audio support · {(support.size / (1 << 20)).toFixed(1)} MiB
                  </Button>
                  <p className="text-xs leading-5 text-muted-foreground">
                    You’ll confirm before downloading. Yap verifies and saves FFmpeg in its data
                    folder without administrator access or PATH changes.
                  </p>
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  Install FFmpeg manually, then refresh. Automatic downloads are available on
                  Windows x64.
                </p>
              ))}
            {downloading && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p role="status" className="text-sm">
                    {status.message} {Math.round(status.progress * 100)}%
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void run(backend.cancel, false)}
                  >
                    Cancel download
                  </Button>
                </div>
                <Progress
                  aria-label="Audio support download progress"
                  className="w-full"
                  value={status.progress * 100}
                />
              </div>
            )}
            {status.phase === "error" && (
              <p role="alert" className="text-sm text-destructive">
                {status.message}
              </p>
            )}
          </>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          Yap’s Windows download uses LGPL v3 or later; the bundled Mac version uses LGPL v2.1 or
          later. Licence and source information accompany these copies.{" "}
          <a
            className="text-primary underline underline-offset-4"
            href="https://ffmpeg.org/legal.html"
            target="_blank"
            rel="noreferrer"
          >
            FFmpeg licensing
          </a>
        </p>
      </div>
    </section>
  );
}
