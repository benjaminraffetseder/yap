import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeadingProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

export function PageHeading({ title, description, children, className }: PageHeadingProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </header>
  );
}
