import { Component, type ErrorInfo, type ReactNode } from "react"
import { RecoveryActions } from "@/components/recovery-actions"

type Failure = { message: string; stack: string }
type State = { failure: Failure | null; componentStack: string }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failure: null, componentStack: "" }
  static getDerivedStateFromError(cause: unknown): State {
    const error = cause instanceof Error ? cause : new Error(typeof cause === "string" ? cause : "Unknown interface error")
    return { failure: { message: error.message, stack: error.stack ?? "" }, componentStack: "" }
  }
  componentDidCatch(_cause: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" })
  }
  render() {
    const { failure, componentStack } = this.state
    if (!failure) return this.props.children
    return <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section aria-labelledby="recovery-title" className="w-full max-w-xl space-y-5 rounded-xl border bg-card p-6">
        <div className="space-y-2"><h1 id="recovery-title" className="text-xl font-semibold">Yap couldn’t display the interface</h1><p role="alert" className="text-sm text-muted-foreground">Retry or reload the window. Saved settings and History are kept; unsaved edits may be lost.</p><p className="text-sm text-muted-foreground">Use the tray or menu bar for recording controls while you recover.</p></div>
        <RecoveryActions source="Interface rendering" details={[failure.stack || failure.message, componentStack].filter(Boolean).join("\n\n")} onRetry={() => this.setState({ failure: null, componentStack: "" })} />
      </section>
    </main>
  }
}
