import { Component, type ErrorInfo, type ReactNode } from "react";
import { RecoveryActions } from "@/components/recovery-actions";
import i18n from "@/i18n";

type Failure = { message: string; stack: string };
type State = { failure: Failure | null; componentStack: string };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failure: null, componentStack: "" };
  static getDerivedStateFromError(cause: unknown): State {
    const error =
      cause instanceof Error
        ? cause
        : new Error(typeof cause === "string" ? cause : i18n.t("errorBoundary.unknown"));
    return { failure: { message: error.message, stack: error.stack ?? "" }, componentStack: "" };
  }
  componentDidCatch(_cause: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" });
  }
  render() {
    const { failure, componentStack } = this.state;
    if (!failure) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section
          aria-labelledby="recovery-title"
          className="w-full max-w-xl space-y-5 rounded-xl border bg-card p-6"
        >
          <div className="space-y-2">
            <h1 id="recovery-title" className="text-xl font-semibold">
              {i18n.t("errorBoundary.title")}
            </h1>
            <p role="alert" className="text-sm text-muted-foreground">
              {i18n.t("errorBoundary.description")}
            </p>
            <p className="text-sm text-muted-foreground">{i18n.t("errorBoundary.hint")}</p>
          </div>
          <RecoveryActions
            source={i18n.t("errorBoundary.source")}
            details={[failure.stack || failure.message, componentStack]
              .filter(Boolean)
              .join("\n\n")}
            onRetry={() => this.setState({ failure: null, componentStack: "" })}
          />
        </section>
      </main>
    );
  }
}
