import { cn } from "@/lib/utils";
import { AudioLines, FileText } from "lucide-react";
import type { ReactNode } from "react";

export function TextPanel({
  title,
  kind,
  description,
  action,
  children,
  variant = "default",
}: {
  title: string;
  kind: "result" | "source";
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  variant?: "default" | "reading";
}) {
  const Icon = kind === "result" ? FileText : AudioLines;
  return (
    <section
      aria-label={title}
      className={cn(
        "min-w-0 rounded-xl border",
        variant === "reading"
          ? "bg-card p-5 sm:p-7"
          : cn("p-4", kind === "result" ? "border-primary/25 bg-primary/5" : "bg-muted/20"),
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-3",
          variant === "reading" ? "mb-7 border-b pb-5" : "mb-3",
        )}
      >
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
      {variant === "reading" ? (
        <div className="mx-auto max-w-[72ch] py-1 sm:py-3">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
