import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { duration, type Session } from "@/lib/backend";
import { ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";

function speechModelLabel(model: string) {
  const match = /^(?:ggml-)?(tiny|base|small)(\.en)?(?:\.bin)?$/i.exec(model);
  return match
    ? `Whisper ${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}${match[2] ? i18n.t("dictationRow.english") : ""}`
    : model;
}

type DictationRowProps = {
  entry: Session;
  disabled?: boolean;
  showDate?: boolean;
  inset?: boolean;
  action?: ReactNode;
  selection?: {
    label: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  };
} & (
  | { to: string; deleted?: never }
  | {
      to?: never;
      deleted: {
        onRestore: () => void;
        onDeletePermanently: () => void;
      };
    }
);

export function DictationRow({
  entry,
  to,
  deleted,
  disabled = false,
  showDate = false,
  inset = true,
  action,
  selection,
}: DictationRowProps) {
  const { t } = useTranslation();
  const text = entry.finalTranscript ?? entry.rawTranscript;
  const content = (
    <div className="min-w-0 flex-1 space-y-2.5">
      {entry.title && (
        <p className="line-clamp-2 break-words text-[0.9375rem] leading-6 font-medium">
          {entry.title}
        </p>
      )}
      <p
        className={`${entry.title ? "line-clamp-1 text-sm text-muted-foreground" : "line-clamp-2 text-[0.9375rem]"} break-words leading-6`}
      >
        {text}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {deleted ? (
          entry.deletedAt &&
          t("dictationRow.deletedStatus", {
            date: new Date(entry.deletedAt).toLocaleDateString(i18n.resolvedLanguage, {
              dateStyle: "medium",
            }),
            days: Math.max(
              0,
              Math.ceil((Date.parse(entry.deletedAt) + 30 * 86400000 - Date.now()) / 86400000),
            ),
          })
        ) : (
          <>
            <time dateTime={entry.createdAt} className="tabular-nums">
              {showDate
                ? new Date(entry.createdAt).toLocaleString(i18n.resolvedLanguage, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : new Date(entry.createdAt).toLocaleTimeString(i18n.resolvedLanguage, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
            </time>
            <span className="tabular-nums">{duration(entry.durationMs)}</span>
            <span className="sr-only">{speechModelLabel(entry.speechModel)}</span>
          </>
        )}
      </div>
    </div>
  );
  return (
    <article
      data-selected={selection?.checked || undefined}
      className="group flex flex-wrap items-stretch border-b last:border-b-0 transition-colors hover:bg-accent/35 data-[selected=true]:bg-primary/8"
    >
      {selection && (
        <label className="flex w-11 shrink-0 cursor-pointer items-start justify-center pt-5 sm:w-14">
          <Checkbox
            aria-label={selection.label}
            checked={selection.checked}
            disabled={disabled}
            onCheckedChange={selection.onCheckedChange}
          />
        </label>
      )}
      {to !== undefined ? (
        <Link
          to={to}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
          className={`flex min-w-0 flex-1 items-center gap-3 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${inset ? `pr-4 sm:pr-5 ${selection ? "" : "pl-5"}` : ""}`}
        >
          {content}
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
          />
        </Link>
      ) : (
        <div className={`min-w-0 flex-1 py-4 pr-3 ${selection ? "" : "pl-5"}`}>{content}</div>
      )}
      {action && <div className="flex shrink-0 items-center pr-3">{action}</div>}
      {deleted && (
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 self-center px-3 pb-3 sm:py-3 sm:pr-5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("historyPage.restore")}
                  className="text-muted-foreground hover:text-foreground"
                  disabled={disabled}
                  onClick={deleted.onRestore}
                />
              }
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="left">{t("historyPage.restore")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("historyPage.deletePermanently")}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={disabled}
                  onClick={deleted.onDeletePermanently}
                />
              }
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="left">{t("historyPage.deletePermanently")}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </article>
  );
}
