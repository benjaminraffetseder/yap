import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SavedDraft } from "./saved-draft";

class DraftStore {
  private drafts = new Map<string, SavedDraft<unknown>>();
  pendingIDs = new Map<string, string>();

  entry<T>(key: string, saved: T) {
    if (!this.drafts.has(key)) this.drafts.set(key, new SavedDraft<unknown>(saved));
    return this.drafts.get(key) as SavedDraft<T>;
  }
  discardSessionDrafts = async (ids: readonly string[]) => {
    const keys = [...this.drafts.keys()].filter((key) =>
      ids.some(
        (id) =>
          key === `chat:${id}` || key === `transcript:${id}` || key.startsWith(`output:${id}:`),
      ),
    );
    await this.discardKeys(keys);
  };
  discardOutputDraft = async (sessionID: string, outputID: string) => {
    await this.discardKeys([`output:${sessionID}:${outputID}`]);
  };
  private discardKeys = async (keys: string[]) => {
    await Promise.all(
      keys.map(async (key) => {
        const entry = this.drafts.get(key);
        if (!entry) return;
        // The session is gone. Let the current write settle and retire any
        // unmount flush queued behind it.
        entry.writer.editor = undefined;
        while (entry.writer.running) await entry.writer.running;
        if (this.drafts.get(key) === entry) this.drafts.delete(key);
      }),
    );
  };
  get protected() {
    return Array.from(this.drafts.values()).some((draft) => draft.protected);
  }
}

const DraftContext = createContext<DraftStore | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new DraftStore());
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (store.protected) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [store]);
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}

function useStore() {
  const store = useContext(DraftContext);
  if (!store) throw new Error("DraftProvider is required");
  return store;
}

// eslint-disable-next-line react-refresh/only-export-components -- Shares the provider's private in-memory cache.
export function useDiscardSessionDrafts(): (ids: readonly string[]) => Promise<void> {
  return useStore().discardSessionDrafts;
}

// eslint-disable-next-line react-refresh/only-export-components -- Shares the draft lifecycle.
export function useDiscardOutputDraft() {
  return useStore().discardOutputDraft;
}

// A pending creation keeps its ID across routes and failures. The receipt
// releases only this creation; the editor keeps its ordinary ID-keyed draft.
// eslint-disable-next-line react-refresh/only-export-components -- Shares the draft lifecycle.
export function useCreationID(kind: string, existingID: string) {
  const store = useStore();
  const [id] = useState(() => {
    if (existingID) return existingID;
    const pending = store.pendingIDs.get(kind) ?? crypto.randomUUID();
    store.pendingIDs.set(kind, pending);
    return pending;
  });
  return {
    id,
    finish() {
      if (store.pendingIDs.get(kind) === id) store.pendingIDs.delete(kind);
    },
  };
}

// Query-backed editors pass the successful read count for the source of saved.
// Other editors reconcile when their saved value changes.
// eslint-disable-next-line react-refresh/only-export-components -- Shares the provider's private in-memory cache.
export function useSavedDraft<T>(key: string, saved: T, readVersion?: number) {
  const store = useStore();
  const entry = store.entry(key, saved);
  const state = useSyncExternalStore(entry.subscribe, entry.snapshot);
  const visible = useMemo(
    () => entry.project(saved, readVersion, state),
    [entry, saved, readVersion, state],
  );
  useLayoutEffect(() => entry.receive(saved, readVersion), [entry, saved, readVersion]);
  const dirty = useMemo(() => entry.dirty(visible), [entry, visible]);
  return [
    visible.value,
    entry.edit,
    {
      entry,
      dirty,
      autosave: {
        owner: entry.writer,
        version: String(visible.edits),
        dirty,
        hasChanges: () => entry.dirty(),
      },
      baseline: visible.baseline,
      edits: visible.edits,
    },
  ] as const;
}
