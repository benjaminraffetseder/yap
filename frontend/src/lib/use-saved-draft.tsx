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

type Draft = { saved: unknown; value: unknown; submitted?: unknown; awaitingSaved?: boolean };
const DraftContext = createContext<Map<string, Draft> | null>(null);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const clean = (draft: Draft) =>
  same(draft.saved, draft.value) || same(draft.submitted, draft.value);
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
      if ([...drafts.current.values()].some((draft) => !clean(draft))) {
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
export function useSavedDraft<T>(
  key: string,
  saved: T,
): [
  T,
  Dispatch<SetStateAction<T>>,
  { dirty: boolean; lastSubmitted: T | undefined; markSubmitted: (value: T) => void },
] {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("DraftProvider is required");
  const [draft, update] = useState<T>(() => {
    const cached = drafts.get(key);
    return cached && (cached.awaitingSaved || !clean(cached)) ? (cached.value as T) : saved;
  });
  const latestSaved = useRef(saved);
  latestSaved.current = saved;
  const [lastSubmitted, setSubmitted] = useState<T | undefined>(
    () => drafts.get(key)?.submitted as T | undefined,
  );
  useEffect(() => {
    const cached = drafts.get(key);
    const receivedSaved = cached && !same(cached.saved, saved);
    update((value) => {
      // Once the submitted value has received its backend snapshot, later
      // external updates can replace a clean draft (for example profile switches).
      const external =
        cached && clean(cached) && !cached.awaitingSaved && !same(cached.saved, saved);
      const next =
        !cached || external
          ? saved
          : reconcile(
              value,
              cached.awaitingSaved && receivedSaved && !Array.isArray(value)
                ? cached.submitted
                : cached.saved,
              saved,
            );
      drafts.set(key, {
        ...cached,
        saved,
        value: next,
        awaitingSaved: cached?.awaitingSaved && !receivedSaved,
        submitted: external ? undefined : cached?.submitted,
      });
      return next;
    });
    if (cached && clean(cached) && !cached.awaitingSaved && !same(cached.saved, saved))
      setSubmitted(undefined);
  }, [drafts, key, saved]);
  const setDraft = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      update((value) => {
        const next = typeof action === "function" ? (action as (value: T) => T)(value) : action;
        drafts.set(key, {
          ...drafts.get(key),
          saved: drafts.get(key)?.saved ?? saved,
          value: next,
        });
        return next;
      });
    },
    [drafts, key, saved],
  );
  const markSubmitted = useCallback(
    (value: T) => {
      const cached = drafts.get(key);
      if (!same(saved, latestSaved.current)) {
        // Collection forms retain their submitted spelling/alias formatting.
        // Their saved query baseline is normalized independently by the backend.
        const current = (cached?.value ?? value) as T;
        const next = Array.isArray(value)
          ? current
          : reconcile(current, value, latestSaved.current);
        const submitted = Array.isArray(value) ? value : undefined;
        drafts.set(key, { saved: latestSaved.current, value: next, submitted });
        update(next);
        setSubmitted(submitted);
        return;
      }
      drafts.set(key, {
        saved,
        value: cached?.value ?? value,
        ...cached,
        submitted: value,
        awaitingSaved: true,
      });
      setSubmitted(value);
    },
    [drafts, key, saved],
  );
  // Project a fresh baseline during the render that receives it. Effects commit
  // the reconciled draft afterwards; clean fields never flash old profile data.
  const cached = drafts.get(key);
  const external = cached && clean(cached) && !cached.awaitingSaved && !same(cached.saved, saved);
  const visible =
    !cached || external
      ? saved
      : reconcile(
          draft,
          // A committed write can outlive a failed refetch. Until a new baseline
          // arrives, the old saved value must not replace the submitted draft.
          cached.awaitingSaved && !same(cached.saved, saved) && !Array.isArray(draft)
            ? cached.submitted
            : cached.saved,
          saved,
        );
  return [
    visible,
    setDraft,
    {
      dirty: !same(visible, saved) && !same(visible, lastSubmitted),
      lastSubmitted,
      markSubmitted,
    },
  ];
}
