import { Checkbox } from "@/components/ui/checkbox";
import { duration, type Session } from "@/lib/backend";
import { AudioLines, ChevronRight, FileText } from "lucide-react";
import { Link } from "react-router";

function speechModelLabel(model: string) {
  const match = /^(?:ggml-)?(tiny|base|small)(\.en)?(?:\.bin)?$/i.exec(model);
  return match
    ? `Whisper ${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}${match[2] ? " · English" : ""}`
    : model;
}

export function DictationRow({
  entry,
  to,
  disabled = false,
  showDate = false,
  selection,
}: {
  entry: Session;
  to: string;
  disabled?: boolean;
  showDate?: boolean;
  selection?: {
    label: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  };
}) {
  const text = entry.finalTranscript ?? entry.rawTranscript;
  const changed = text !== entry.rawTranscript;
  const Icon = changed ? FileText : AudioLines;
  return (
    <article
      data-selected={selection?.checked || undefined}
      className="group flex items-stretch border-b last:border-b-0 transition-colors hover:bg-accent/35 data-[selected=true]:bg-primary/8"
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
      <Link
        to={to}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        className={`flex min-w-0 flex-1 items-center gap-3 py-4 pr-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:pr-5 ${selection ? "" : "pl-5"}`}
      >
        <div className="min-w-0 flex-1 space-y-2.5">
          <p className="line-clamp-2 break-words text-sm font-medium leading-6">{text}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 ${changed ? "bg-primary/10 text-primary" : "bg-muted/60"}`}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {changed ? "Result" : "Transcription"}
            </span>
            <time dateTime={entry.createdAt} className="tabular-nums">
              {showDate
                ? new Date(entry.createdAt).toLocaleString()
                : new Date(entry.createdAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
            </time>
            <span className="tabular-nums">{duration(entry.durationMs)}</span>
            <span className="min-w-0 truncate" title={entry.speechModel}>
              {speechModelLabel(entry.speechModel)}
            </span>
          </div>
        </div>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
        />
      </Link>
    </article>
  );
}
