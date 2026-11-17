import { Indicator } from "@/features/indicator/components/indicator";
import "@/i18n";
import "@/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./indicator.css";

createRoot(document.getElementById("indicator-root")!).render(
  <StrictMode>
    <Indicator />
  </StrictMode>,
);
