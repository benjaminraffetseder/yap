import type { ProcessingOption } from "@/lib/backend";
import { Workflow } from "lucide-react";

export function ProcessingOptionLabel({ option }: { option: ProcessingOption }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      {option.isChain && (
        <Workflow aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{option.label}</span>
    </span>
  );
}
