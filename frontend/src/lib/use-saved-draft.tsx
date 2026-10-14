import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type Draft = { saved: unknown; value: unknown };
const DraftContext = createContext<Map<string, Draft> | null>(null);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function reconcile<T>(value: T, baseline: unknown, saved: T): T {
  if (same(value, baseline)) return saved;
  if (
    value &&
    baseline &&
    saved &&
    typeof value === "object" &&
    typeof baseline === "object" &&
    typeof saved === "object" &&
    !Array.isArray(value)
  ) {
    // A profile or tray action may change other settings while this page is
    // away. Preserve edited fields and adopt fresh values for untouched ones.
    const old = baseline as Record<string, unknown>;
    return {
      ...saved,
      ...Object.fromEntries(Object.entries(value).filter(([key, field]) => !same(field, old[key]))),
    };
  }
  return value;
}

export function DraftProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, Draft>());
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ([...drafts.current.values()].some((draft) => !same(draft.saved, draft.value))) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  return <DraftContext.Provider value={drafts.current}>{children}</DraftContext.Provider>;
}

// Drafts live above the router, in memory only. Clean drafts follow backend
// updates; dirty drafts survive navigation and failed saves until discarded.
// eslint-disable-next-line react-refresh/only-export-components -- The hook shares the provider's private in-memory cache.
export function useSavedDraft<T>(key: string, saved: T): [T, Dispatch<SetStateAction<T>>] {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("DraftProvider is required");
  const [draft, update] = useState<T>(() => {
    const cached = drafts.get(key);
    return cached && !same(cached.saved, cached.value) ? (cached.value as T) : saved;
  });
  useEffect(() => {
    const cached = drafts.get(key);
    update((value) => {
      const next = !cached ? saved : reconcile(value, cached.saved, saved);
      drafts.set(key, { saved, value: next });
      return next;
    });
  }, [drafts, key, saved]);
  const setDraft = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      update((value) => {
        const next = typeof action === "function" ? (action as (value: T) => T)(value) : action;
        drafts.set(key, { saved: drafts.get(key)?.saved ?? saved, value: next });
        return next;
      });
    },
    [drafts, key, saved],
  );
  return [draft, setDraft];
}
