import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { backend, isBusy, isDesktop } from "@/lib/backend";
import { Keyboard } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

export function ShortcutStatus({
  disabled = false,
  profile = false,
  variant = "inline",
}: {
  disabled?: boolean;
  profile?: boolean;
  variant?: "inline" | "banner";
}) {
  const { snapshot, run } = useDictation();
  const [pending, setPending] = useState(false);
  const retrying = useRef(false);
  const error = profile ? snapshot.status.profileShortcutError : snapshot.status.shortcutError;
  if (!error) return null;
  async function retry() {
    if (retrying.current) return;
    retrying.current = true;
    setPending(true);
    try {
      await run(backend.retryShortcut);
    } finally {
      retrying.current = false;
      setPending(false);
    }
  }
  const retryButton = (
    <Button
      variant="outline"
      size="sm"
      className={
        variant === "banner"
          ? "h-auto min-h-8 max-w-full whitespace-normal py-1 [overflow-wrap:anywhere]"
          : undefined
      }
      disabled={disabled || pending || !isDesktop || isBusy(snapshot.status.phase)}
      onClick={() => void retry()}
    >
      {pending ? "Retrying…" : profile ? "Retry profile shortcut" : "Retry shortcut"}
    </Button>
  );
  if (variant === "banner") {
    const permission = /accessibility|permission|input monitoring/i.test(error);
    return (
      <section
        aria-label="Shortcut recovery"
        className="@container/shortcut min-w-0 rounded-xl border border-amber-500/25 bg-amber-500/5 [overflow-wrap:anywhere]"
      >
        <div className="flex min-w-0 gap-3 p-4 @max-[20rem]/shortcut:p-3">
          <Keyboard
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-amber-700 @max-[20rem]/shortcut:hidden dark:text-amber-400"
          />
          <div className="min-w-0 flex-1 space-y-3">
            <div role="alert" className="space-y-1">
              <p className="text-sm font-medium">
                {profile ? "Profile shortcut unavailable" : "Global shortcut unavailable"}
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                {permission
                  ? "Allow Yap in your system’s accessibility settings, then retry."
                  : "Release this shortcut in the other app, or choose a different combination."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {retryButton}
              <Button
                variant="ghost"
                size="sm"
                className="h-auto min-h-8 max-w-full whitespace-normal py-1"
                render={
                  <Link
                    to={`/settings?section=dictation&focus=${profile ? "profile-cycle-shortcut" : "shortcut"}`}
                  />
                }
              >
                Change shortcut
              </Button>
            </div>
            <details className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
              <summary className="w-fit cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Technical details
              </summary>
              <p className="mt-2">{error}</p>
            </details>
          </div>
        </div>
      </section>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
      {retryButton}
    </div>
  );
}
