import type { ReactNode } from "react";
import { AudioLines, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export function TextPanel({
  title,
  kind,
  description,
  action,
  children,
}: {
  title: string;
  kind: "result" | "source";
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const Icon = kind === "result" ? FileText : AudioLines;
  return (
    <section
      aria-label={title}
      className={cn(
        "min-w-0 rounded-xl border p-4",
        kind === "result" ? "border-primary/25 bg-primary/5" : "bg-muted/20",
      )}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Icon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                kind === "result" ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className="min-w-0 break-words">{title}</span>
          </h3>
          {description && (
            <p className="mt-1 break-words text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
