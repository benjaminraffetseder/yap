import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { hasOpenKeyboardOverlay } from "@/lib/keyboard-shortcuts";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

// CSS Highlights leave citation/source spans and the reader's selection intact.
// Only the active detail document owns the global highlight names and shortcut.
export type DocumentFindHandle = { open: () => void };

export function DocumentFind({
  children,
  active = true,
  text,
  ref,
  showTrigger = true,
  returnFocus,
}: {
  children: ReactNode;
  active?: boolean;
  text: string;
  ref?: Ref<DocumentFindHandle>;
  showTrigger?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const ranges = useRef<Range[]>([]);
  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!active) return;
        setOpen(true);
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.select();
        });
      },
    }),
    [active],
  );
  function close() {
    setOpen(false);
    (returnFocus?.current ?? trigger.current)?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!active) return;
    function keydown(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "f" ||
        event.altKey ||
        event.isComposing ||
        event.defaultPrevented ||
        hasOpenKeyboardOverlay()
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, [contenteditable="true"]') &&
        !content.current?.contains(target) &&
        target !== input.current
      )
        return;
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active]);
  useEffect(() => {
    if (!active || !open || !query || !content.current) {
      ranges.current = [];
      setCount(0);
      return;
    }
    const walker = document.createTreeWalker(content.current, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number }[] = [];
    let value = "";
    let block: Element | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const nextBlock =
        node.parentElement?.closest("p,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote") ?? null;
      if (value && nextBlock !== block) value += "\n";
      block = nextBlock;
      nodes.push({ node, start: value.length });
      value += node.data;
    }
    function point(offset: number) {
      let low = 0,
        high = nodes.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (nodes[middle].start <= offset) low = middle + 1;
        else high = middle;
      }
      const entry = nodes[low - 1];
      return entry && offset - entry.start <= entry.node.length ? entry : undefined;
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, matchCase ? "gu" : "giu");
    const word = (char: string) => /[\p{L}\p{N}\p{M}_]/u.test(char);
    const found: Range[] = [];
    for (const match of value.matchAll(pattern)) {
      const start = match.index,
        end = start + match[0].length;
      if (
        wholeWord &&
        (word(Array.from(value.slice(Math.max(0, start - 2), start)).at(-1) ?? "") ||
          word(Array.from(value.slice(end, end + 2))[0] ?? ""))
      )
        continue;
      const first = point(start);
      const last = point(end);
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      found.push(range);
    }
    ranges.current = found;
    setCount(found.length);
    setCurrent(0);
  }, [active, open, query, matchCase, wholeWord, text, children]);
  useEffect(() => {
    if (!active || !open || typeof Highlight === "undefined" || !CSS.highlights) return;
    CSS.highlights.set("yap-find", new Highlight(...ranges.current));
    const range = ranges.current[current];
    if (range) {
      CSS.highlights.set("yap-find-current", new Highlight(range));
      range.startContainer.parentElement?.scrollIntoView({ block: "nearest" });
    } else CSS.highlights.delete("yap-find-current");
    return () => {
      CSS.highlights.delete("yap-find");
      CSS.highlights.delete("yap-find-current");
    };
  }, [active, open, current, count, query, matchCase, wholeWord, text]);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-slot="document-find">
      <style>
        {
          "::highlight(yap-find){background:var(--accent);color:var(--accent-foreground)}::highlight(yap-find-current){background:var(--primary);color:var(--primary-foreground)}"
        }
      </style>
      {open && active ? (
        <div
          role="search"
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              setCurrent((value) =>
                count ? (value + (event.shiftKey ? count - 1 : 1)) % count : 0,
              );
            }
          }}
        >
          <Input
            ref={input}
            aria-label={t("contentEditor.findInDocument")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 min-w-32 flex-1"
          />
          <span role="status" className="text-xs tabular-nums text-muted-foreground">
            {count ? current + 1 : 0} / {count}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("historyPage.previous")}
            disabled={!count}
            onClick={() => setCurrent((value) => (value + count - 1) % count)}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.next")}
            disabled={!count}
            onClick={() => setCurrent((value) => (value + 1) % count)}
          >
            <ChevronDown />
          </Button>
          <label htmlFor={`${id}-case`} className="flex items-center gap-1 text-xs">
            <Checkbox
              id={`${id}-case`}
              checked={matchCase}
              onCheckedChange={(checked) => setMatchCase(checked === true)}
            />
            {t("contentEditor.matchCase")}
          </label>
          <label htmlFor={`${id}-word`} className="flex items-center gap-1 text-xs">
            <Checkbox
              id={`${id}-word`}
              checked={wholeWord}
              onCheckedChange={(checked) => setWholeWord(checked === true)}
            />
            {t("contentEditor.wholeWord")}
          </label>
          <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={close}>
            <X />
          </Button>
        </div>
      ) : (
        active &&
        showTrigger && (
          <Button
            ref={trigger}
            size="sm"
            variant="ghost"
            className="h-auto min-h-8 max-w-full self-start text-left whitespace-normal text-muted-foreground"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            <Search />
            {t("contentEditor.findInDocument")}
          </Button>
        )
      )}
      <div ref={content}>{children}</div>
    </div>
  );
}
