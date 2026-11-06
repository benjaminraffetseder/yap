import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="audio-support-title" className="text-sm font-semibold">
          {t("audioSupportPanel.audioSupportFFmpeg")}
        </h2>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("audioSupportPanel.refreshAudioSupport")}
          disabled={!isDesktop || checking || busy || pending}
          onClick={() => void refresh()}
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-4 ${checking ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          {t("uiPolish.refresh")}
        </Button>
      </div>
      <div className="space-y-4 px-5 py-4">
        <p className="text-xs leading-5 text-muted-foreground">{t("uiPolish.audioFormatsHelp")}</p>
        {!isDesktop ? (
          <p className="text-sm text-muted-foreground">
            {t("audioSupportPanel.openYapOnYourDesktopToManage")}
          </p>
        ) : (
          <>
            {checking && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("audioSupportPanel.checkingAudioSupport")}
              </p>
            )}
            {support && (
              <div className="space-y-2">
                <p role="status" className="text-sm">
                  {nativeText(support.message)}
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {nativeText(error)}
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
                    {t("audioSupportPanel.downloadAudioSupport")}{" "}
                    {(support.size / (1 << 20)).toFixed(1)} {t("audioSupportPanel.miB")}
                  </Button>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("audioSupportPanel.youLlConfirmBeforeDownloadingYapVerifies")}
                  </p>
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("audioSupportPanel.installFFmpegManuallyThenRefreshAutomaticDownloads")}
                </p>
              ))}
            {downloading && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p role="status" className="text-sm">
                    {nativeText(status.message)} {Math.round(status.progress * 100)}%
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void run(backend.cancel, false)}
                  >
                    {t("homePage.cancelDownload")}
                  </Button>
                </div>
                <Progress
                  aria-label={t("audioSupportPanel.audioSupportDownloadProgress")}
                  className="w-full"
                  value={status.progress * 100}
                />
              </div>
            )}
            {status.phase === "error" && (
              <p role="alert" className="text-sm text-destructive">
                {nativeText(status.message)}
              </p>
            )}
          </>
        )}
        <details className="text-xs leading-5 text-muted-foreground">
          <summary className="cursor-pointer font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("uiPolish.technicalDetails")}
          </summary>
          <div className="mt-3 space-y-3 border-t pt-3">
            <p>{t("audioSupportPanel.fFmpegEnablesMP3M4AAACFLACOGG")}</p>
            {support?.path && <p className="break-all font-mono">{support.path}</p>}
            <p>
              {t("audioSupportPanel.licenseDetails")}{" "}
              <a
                className="text-primary underline underline-offset-4"
                href="https://ffmpeg.org/legal.html"
                target="_blank"
                rel="noreferrer"
              >
                {t("audioSupportPanel.fFmpegLicensing")}
              </a>
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
