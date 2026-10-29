import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Indicator } from "@/components/indicator";
import "@/index.css";
import "./indicator.css";

createRoot(document.getElementById("indicator-root")!).render(
  <StrictMode>
    <Indicator />
  </StrictMode>,
);
