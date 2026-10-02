import { useEffect, useMemo, useRef, useState } from "react"
import { version } from "../../package.json"

const buttonClass = "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

// Keep recovery controls independent of app context and UI primitive providers.
export function RecoveryActions({ source, details, onRetry, retryLabel = "Retry interface" }: { source: string; details: string; onRetry: () => void; retryLabel?: string }) {
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const retry = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const request = useRef(0)
  const report = useMemo(() => [
    "Yap interface diagnostics", `Source: ${source}`, "", details.slice(0, 16000), "",
    `Version: ${version}`, `Time: ${new Date().toISOString()}`,
    `Route: ${window.location.hash || "/"}`, `Webview: ${navigator.userAgent}`,
  ].join("\n"), [source, details])
  useEffect(() => {
    setCopied(false); setCopyError(false); setCopying(false)
    return () => { request.current++ }
  }, [report])
  useEffect(() => { retry.current?.focus() }, [])
  useEffect(() => { if (copyError) { field.current?.focus(); field.current?.select() } }, [copyError])
  async function copy() {
    const id = ++request.current
    setCopying(true); setCopyError(false); setCopied(false)
    try {
      const runtime = (window as unknown as { runtime?: { ClipboardSetText?: (text: string) => Promise<boolean> } }).runtime
      if (typeof runtime?.ClipboardSetText === "function") {
        if (!await runtime.ClipboardSetText(report)) throw new Error("Clipboard unavailable")
      } else if (!("go" in window) && navigator.clipboard) {
        await navigator.clipboard.writeText(report)
      } else throw new Error("Clipboard unavailable")
      if (request.current === id) setCopied(true)
    } catch {
      if (request.current === id) { setCopyError(true); setExpanded(true) }
    } finally { if (request.current === id) setCopying(false) }
  }
  return <div className="space-y-3 text-foreground">
    <div className="flex flex-wrap gap-2">
      <button ref={retry} type="button" className={`${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`} onClick={onRetry}>{retryLabel}</button>
      <button type="button" className={`${buttonClass} border bg-background hover:bg-accent`} onClick={() => window.location.reload()}>Reload window</button>
    </div>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Technical details</summary>
      <div className="mt-3 space-y-2">
        <label htmlFor="recovery-details" className="sr-only">Diagnostic details</label>
        <textarea ref={field} id="recovery-details" readOnly rows={7} value={report} className="w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={copying} className={`${buttonClass} border bg-background hover:bg-accent`} onClick={() => void copy()}>{copying ? "Copying…" : "Copy diagnostics"}</button>{copied && <span role="status" className="text-xs text-muted-foreground">Diagnostics copied.</span>}</div>
        {copyError && <p role="alert" className="text-xs text-destructive">Could not copy. Select the details above and copy manually.</p>}
      </div>
    </details>
  </div>
}
