import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { isDesktop } from "@/lib/desktop";
import { Clipboard } from "@wailsio/runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { version } from "../../package.json";

const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

// Keep recovery controls independent of app context and UI primitive providers.
export function RecoveryActions({
  source,
  details,
  onRetry,
  retryLabel = i18n.t("recoveryActions.retryInterface"),
}: {
  source: string;
  details: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const retry = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const request = useRef(0);
  const report = useMemo(
    () =>
      [
        "Yap interface diagnostics",
        `Source: ${source}`,
        "",
        details.slice(0, 16000),
        "",
        `Version: ${version}`,
        `Time: ${new Date().toISOString()}`,
        `Route: ${window.location.hash || "/"}`,
        `Webview: ${navigator.userAgent}`,
      ].join("\n"),
    [source, details],
  );
  useEffect(() => {
    setCopied(false);
    setCopyError(false);
    setCopying(false);
    return () => {
      request.current++;
    };
  }, [report]);
  useEffect(() => {
    retry.current?.focus();
  }, []);
  useEffect(() => {
    if (copyError) {
      field.current?.focus();
      field.current?.select();
    }
  }, [copyError]);
  async function copy() {
    const id = ++request.current;
    setCopying(true);
    setCopyError(false);
    setCopied(false);
    try {
      if (isDesktop) {
        await Clipboard.SetText(report);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(report);
      } else throw new Error(t("recoveryActions.clipboardUnavailable"));
      if (request.current === id) setCopied(true);
    } catch {
      if (request.current === id) {
        setCopyError(true);
        setExpanded(true);
      }
    } finally {
      if (request.current === id) setCopying(false);
    }
  }
  return (
    <div className="space-y-3 text-foreground">
      <div className="flex flex-wrap gap-2">
        <button
          ref={retry}
          type="button"
          className={`${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
        <button
          type="button"
          className={`${buttonClass} border bg-background hover:bg-accent`}
          onClick={() => window.location.reload()}
        >
          {t("recoveryActions.reloadWindow")}
        </button>
      </div>
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        className="text-sm"
      >
        <summary className="cursor-pointer text-muted-foreground">
          {t("diagnosticsPanel.technicalDetails")}
        </summary>
        <div className="mt-3 space-y-2">
          <label htmlFor="recovery-details" className="sr-only">
            {t("recoveryActions.diagnosticDetails")}
          </label>
          <textarea
            ref={field}
            id="recovery-details"
            readOnly
            rows={7}
            value={report}
            className="w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={copying}
              className={`${buttonClass} border bg-background hover:bg-accent`}
              onClick={() => void copy()}
            >
              {copying ? t("recoveryActions.copying") : t("recoveryActions.copyDiagnostics")}
            </button>
            {copied && (
              <span role="status" className="text-xs text-muted-foreground">
                {t("recoveryActions.diagnosticsCopied")}
              </span>
            )}
          </div>
          {copyError && (
            <p role="alert" className="text-xs text-destructive">
              {t("recoveryActions.couldNotCopySelectTheDetailsAbove")}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
