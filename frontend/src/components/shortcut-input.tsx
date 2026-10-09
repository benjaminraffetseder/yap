import { useEffect, useRef, useState, type RefObject } from "react";
import { EventsOn } from "@wails/runtime/runtime";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backend, isDesktop, message } from "@/lib/backend";

export function ShortcutInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1 basis-32"
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setError("");
            onChange(event.target.value);
          }}
        />
        <Button
          ref={trigger}
          variant="outline"
          disabled={disabled || !isDesktop}
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          <Keyboard className="size-4" />
          Record shortcut
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {open && (
        <ShortcutCapture
          returnFocus={trigger}
          onFinish={(captured, warning) => {
            setOpen(false);
            setError(warning);
            if (captured) onChange(captured);
          }}
        />
      )}
    </>
  );
}

function ShortcutCapture({
  returnFocus,
  onFinish,
}: {
  returnFocus: RefObject<HTMLButtonElement | null>;
  onFinish: (value: string | undefined, warning: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [candidate, setCandidate] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [held, setHeld] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const lease = useRef("");
  const acquisition = useRef<Promise<string> | null>(null);
  const mounted = useRef(false);
  const closing = useRef(false);
  const finish = useRef<(value?: string, warning?: string) => void>(() => {});
  finish.current = (value, warning = "") => {
    if (closing.current) return;
    closing.current = true;
    setFinishing(true);
    void (lease.current ? backend.endShortcutCapture(lease.current) : Promise.resolve()).then(
      () => onFinish(value, warning),
      (cause) => onFinish(value, message(cause)),
    );
  };
  useEffect(() => {
    let active = true;
    mounted.current = true;
    const off = EventsOn("shortcut:capture-ended", (token: string) => {
      if (active && token === lease.current && !closing.current)
        finish.current(undefined, "Shortcut capture timed out. Try again.");
    });
    const blur = () => finish.current(undefined, "Shortcut capture cancelled when Yap lost focus.");
    const visibility = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    const timer = setTimeout(
      () => finish.current(undefined, "Shortcut capture timed out. Try again."),
      45000,
    );
    // Strict Mode reconnects effects. Share the in-flight lease instead of
    // acquiring twice, and release only if no reconnected effect owns it.
    acquisition.current ??= backend.beginShortcutCapture();
    void acquisition.current
      .then((token) => {
        if (!active) {
          if (!mounted.current) void backend.endShortcutCapture(token).catch(() => {});
          return;
        }
        if (closing.current) {
          void backend.endShortcutCapture(token).catch(() => {});
          return;
        }
        lease.current = token;
        setReady(true);
        area.current?.focus();
      })
      .catch((cause) => {
        if (active && !closing.current) setError(message(cause));
      });
    return () => {
      active = false;
      mounted.current = false;
      clearTimeout(timer);
      off();
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      queueMicrotask(() => {
        if (!mounted.current && lease.current)
          void backend.endShortcutCapture(lease.current).catch(() => {});
      });
    };
  }, []);
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !finishing) finish.current();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={area}
        finalFocus={returnFocus}
        onKeyUpCapture={(event) => {
          keys.current.delete(event.code || event.key);
          setHeld(
            keys.current.size > 0 ||
              event.ctrlKey ||
              event.altKey ||
              event.shiftKey ||
              event.metaKey,
          );
        }}
      >
        <DialogHeader>
          <DialogTitle>Record shortcut</DialogTitle>
          <DialogDescription>Ctrl, Alt, or Shift with Space, A–Z, or F1–F12.</DialogDescription>
        </DialogHeader>
        <div
          ref={area}
          role="group"
          aria-label="Shortcut capture"
          aria-describedby="shortcut-capture-help"
          tabIndex={0}
          className="rounded-xl border bg-muted/40 px-4 py-8 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(event) => {
            if (event.key === "Tab" || event.key === "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (!ready || finishing || event.repeat) return;
            keys.current.add(event.code || event.key);
            setHeld(true);
            if (event.metaKey || event.getModifierState("AltGraph")) {
              setCandidate("");
              setPreview("");
              setError("Use Ctrl, Alt, or Shift. Command, Windows, and AltGr are not supported.");
              return;
            }
            if (event.nativeEvent.isComposing || event.key === "Dead" || event.key === "Process") {
              setCandidate("");
              setPreview("");
              setError("Finish composing text, then press a shortcut.");
              return;
            }
            const modifiers = [
              event.ctrlKey && "Ctrl",
              event.altKey && "Alt",
              event.shiftKey && "Shift",
            ].filter(Boolean) as string[];
            if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
              setCandidate("");
              setPreview(modifiers.length ? `${modifiers.join("+")}+…` : "");
              setError("");
              return;
            }
            // macOS registers logical letters through the active layout. A US
            // physical code cannot identify an Option-generated base letter.
            const ambiguousMacLetter =
              /Mac/.test(navigator.platform) &&
              !/^[a-z]$/i.test(event.key) &&
              /^Key[A-Z]$/.test(event.code);
            if (ambiguousMacLetter) {
              setCandidate("");
              setPreview("");
              setError(
                "Enter this shortcut manually using the base letter, or record Space or F1–F12.",
              );
              return;
            }
            const key =
              event.code === "Space" || event.key === " "
                ? "Space"
                : /^[a-z]$/i.test(event.key)
                  ? event.key.toUpperCase()
                  : /^F([1-9]|1[0-2])$/.test(event.key)
                    ? event.key
                    : (event.ctrlKey || event.altKey) && /^Key[A-Z]$/.test(event.code)
                      ? event.code.slice(3)
                      : "";
            if (!modifiers.length || !key) {
              setCandidate("");
              setPreview("");
              setError(
                !modifiers.length
                  ? "Include at least one modifier: Ctrl, Alt, or Shift."
                  : "Use Space, A–Z, or F1–F12.",
              );
              return;
            }
            const captured = [...modifiers, key].join("+");
            setCandidate(captured);
            setPreview(captured);
            setError("");
          }}
        >
          <span aria-live="polite" className="font-mono text-lg">
            {preview || (ready ? "Press a key combination" : "Preparing capture…")}
          </span>
        </div>
        <p id="shortcut-capture-help" className="text-xs text-muted-foreground">
          {candidate && held
            ? "Release the keys to continue."
            : "Tab moves to the buttons. Escape cancels. The shortcut is checked when saved."}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={finishing} onClick={() => finish.current()}>
            Cancel
          </Button>
          <Button
            disabled={!ready || !candidate || held || finishing}
            onClick={() => finish.current(candidate)}
          >
            Use shortcut
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
