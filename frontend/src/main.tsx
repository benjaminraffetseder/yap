import { App } from "@/app";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import "@/i18n";
import "@/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

if (document.getElementById("unsupported-engine")?.hidden !== false) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
