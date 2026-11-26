export function searchHighlightAttributes(current: boolean): Record<string, string> {
  return {
    class: [
      "rounded-[0.15em]",
      current
        ? "bg-[color-mix(in_oklch,var(--primary)_40%,transparent)] outline-2 outline-solid outline-primary outline-offset-1"
        : "bg-[color-mix(in_oklch,var(--primary)_25%,transparent)]",
    ].join(" "),
    "data-editor-search-match": current ? "current" : "match",
  };
}
