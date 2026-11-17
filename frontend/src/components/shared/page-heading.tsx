import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type PageHeadingProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

export function PageHeading({ title, description, children, className }: PageHeadingProps) {
  return (
    <header
      data-slot="page-heading"
      className={cn("flex flex-wrap items-end justify-between gap-4 border-b pb-6", className)}
    >
      <div className="min-w-0">
        <h1 className="text-[clamp(1.75rem,2.8vw,2.5rem)] leading-tight font-semibold tracking-[-0.055em] [overflow-wrap:anywhere]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </header>
  );
}
