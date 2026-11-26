import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDictationActions,
  useDictationConnection,
  useDictationStatus,
  useSavedConfiguration,
} from "@/features/dictation/hooks/use-dictation-state";
import { nativeText } from "@/i18n/native-text";
import { backend, isDesktop } from "@/lib/backend";
import { Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function AudioImportButton({
  showDownloadProgress = true,
  quiet = false,
  label,
  iconOnly = false,
}: {
  showDownloadProgress?: boolean;
  quiet?: boolean;
  label?: ReactNode;
  iconOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { run } = useDictationActions();
  const { loading } = useDictationConnection();
  const snapshot = { ...useSavedConfiguration(), status: useDictationStatus() };
  const [pending, setPending] = useState(false);
  async function importAudio() {
    setPending(true);
    try {
      await run(backend.importAudio);
    } finally {
      setPending(false);
    }
  }
  const disabled = !isDesktop || loading || !snapshot.ready || pending;
  const button = (
    <Button
      pressFeedback
      variant={quiet ? "ghost" : "outline"}
      size={iconOnly ? "icon" : "default"}
      className={quiet ? "max-w-full whitespace-normal text-muted-foreground" : undefined}
      aria-label={t("audioImportButton.importAudio")}
      title={iconOnly ? undefined : t("audioImportButton.wAVMP3M4AAACFLACOGGOpus")}
      disabled={disabled}
      onClick={() => void importAudio()}
    >
      <Upload aria-hidden="true" />
      <span className={iconOnly ? "sr-only" : undefined}>
        {label ?? t("audioImportButton.importAudio")}
      </span>
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      {iconOnly ? (
        <Tooltip>
          <TooltipTrigger render={button} disabled={disabled} />
          <TooltipContent className="flex-col items-start">
            <span>{t("audioImportButton.importAudio")}</span>
            <span>{t("audioImportButton.wAVMP3M4AAACFLACOGGOpus")}</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      {showDownloadProgress &&
        snapshot.status.phase === "downloading" &&
        !snapshot.status.importId && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span role="status">
              {nativeText(snapshot.status.message)} {Math.round(snapshot.status.progress * 100)}%
            </span>
            <Progress
              aria-label={t("homePage.downloadProgress")}
              className="w-24"
              value={snapshot.status.progress * 100}
            />
            <Button size="sm" variant="outline" onClick={() => void run(backend.cancel, false)}>
              {t("homePage.cancelDownload")}
            </Button>
          </div>
        )}
    </div>
  );
}
