import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
}: {
  showDownloadProgress?: boolean;
  quiet?: boolean;
  label?: ReactNode;
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
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        pressFeedback
        variant={quiet ? "ghost" : "outline"}
        className={quiet ? "max-w-full whitespace-normal text-muted-foreground" : undefined}
        aria-label={t("audioImportButton.importAudio")}
        title={t("audioImportButton.wAVMP3M4AAACFLACOGGOpus")}
        disabled={!isDesktop || loading || !snapshot.ready || pending}
        onClick={() => void importAudio()}
      >
        <Upload aria-hidden="true" className="size-4" />
        {label ?? t("audioImportButton.importAudio")}
      </Button>
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
