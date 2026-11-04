import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { backend, isDesktop } from "@/lib/backend";
import { Upload } from "lucide-react";
import { useState } from "react";

export function AudioImportButton({
  showDownloadProgress = true,
  quiet = false,
}: {
  showDownloadProgress?: boolean;
  quiet?: boolean;
}) {
  const { t } = useTranslation();
  const { snapshot, loading, run } = useDictation();
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
        title={t("audioImportButton.wAVMP3M4AAACFLACOGGOpus")}
        disabled={!isDesktop || loading || !snapshot.ready || pending}
        onClick={() => void importAudio()}
      >
        <Upload className="size-4" />
        {t("audioImportButton.importAudio")}
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
