import { useAudioLevel } from "@/features/dictation/hooks/use-dictation-state";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function AudioMeter({ label, className }: { label: string; className?: string }) {
  const { t } = useTranslation();
  const level = useAudioLevel();
  const inputLevel = Math.min(1, Math.max(0, level));
  return (
    <div className={cn("w-full max-w-xs", className)}>
      <div aria-hidden="true" className="flex h-12 items-end gap-1.5">
        {Array.from({ length: 24 }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-full min-w-0 flex-1 rounded-sm transition-colors motion-reduce:transition-none",
              inputLevel * 24 > index ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("setupPage.inputLevel")}</span>
        <span className="tabular-nums">{`${Math.round(inputLevel * 100)}%`}</span>
      </div>
      <meter aria-label={label} className="sr-only" min={0} max={1} value={level} />
    </div>
  );
}
