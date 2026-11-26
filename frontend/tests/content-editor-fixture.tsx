import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { dictationContexts } from "../src/features/dictation/hooks/use-dictation-state";
import { ContentEditor } from "../src/features/editing/components/content-editor";
import "../src/i18n";
import "../src/index.css";
import { backend, type VocabularyEntry } from "../src/lib/backend";
import { emptySnapshot } from "../src/lib/queries/resource-defaults";
import { resourceKeys } from "../src/lib/queries/resource-queries";

export function mount(
  initial: string,
  options: { readOnly?: boolean; vocabulary?: VocabularyEntry[]; model?: boolean } = {},
) {
  document.querySelector<HTMLElement>("#root")!.style.display = "none";
  const container = document.createElement("div");
  container.className = "p-4";
  document.body.appendChild(container);
  const query = new QueryClient();
  query.setQueryData(resourceKeys.configuration, {
    ...emptySnapshot,
    textProcessing: {
      ...emptySnapshot.textProcessing,
      enabled: options.model !== false,
      model: options.model === false ? "" : "local",
    },
  });
  query.setQueryData(resourceKeys.vocabulary, options.vocabulary ?? []);
  const state = {
    value: initial,
    writes: [] as string[],
    remembered: [] as unknown[],
    external: (value: string): void => {
      void value;
    },
    dictionary: (entries: VocabularyEntry[]) =>
      query.setQueryData(resourceKeys.vocabulary, entries),
    result: "Refined text",
    pending: false,
    cancelDeferred: false,
    error: "",
    finish: (value: string): void => {
      void value;
    },
    requested: [] as unknown[][],
  };
  Reflect.set(backend, "refineSelection", async (...args: string[]) => {
    state.requested.push(args);
    if (state.error) throw new Error(state.error);
    if (state.pending)
      return new Promise<string>((resolve) => {
        state.finish = resolve;
      });
    return state.result;
  });
  Reflect.set(backend, "cancelTextProcessing", async () => {
    if (!state.cancelDeferred) state.finish("");
  });
  Reflect.set(backend, "addVocabularyTerm", async (...args: unknown[]) => {
    state.remembered.push(args);
  });
  Reflect.set(backend, "copy", async () => {});
  Reflect.set(window, "contentEditorFixture", state);
  function Fixture() {
    const [value, setValue] = useState(initial);
    state.external = (next) => {
      state.value = next;
      setValue(next);
    };
    return (
      <QueryClientProvider client={query}>
        <MemoryRouter>
          <dictationContexts.activity.Provider value={{ ...emptySnapshot.status, phase: "idle" }}>
            <input aria-label="Unrelated field" />
            <p id="fixture-description">Fixture accessible description</p>
            <ContentEditor
              id="fixture-document"
              label="Fixture document"
              describedBy="fixture-description"
              value={value}
              readOnly={options.readOnly}
              onChange={(next) => {
                state.value = next;
                state.writes.push(next);
                setValue(next);
              }}
            />
          </dictationContexts.activity.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  createRoot(container).render(<Fixture />);
}
