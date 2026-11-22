import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { SaveOwner } from "./saved-draft";

export type AutoSaveState = "saved" | "saving" | "waiting" | "blocked" | "failed";

type Options = {
  owner: SaveOwner;
  version: string;
  dirty: boolean;
  hasChanges: () => boolean;
  canSave: boolean;
  save: () => Promise<void | boolean>;
  delay?: number;
  waitForBlur?: boolean;
};

export function useAutoSave(options: Options) {
  const { owner, version, dirty, canSave, delay = 400, waitForBlur = false } = options;
  useSyncExternalStore(owner.subscribe, owner.snapshot);
  const latest = useRef(options);
  const editor = useRef(Symbol());
  const deferred = useRef<string>(undefined);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const flush = useCallback(
    async (retry = false): Promise<boolean> => {
      // An unmount flush may be waiting for a receipt when another editor
      // takes ownership. Only the current editor may start the next write.
      while (owner.running) await owner.running;
      if (owner.editor !== editor.current) return true;
      const current = latest.current;
      if (!current.hasChanges()) return true;
      if (
        !current.canSave ||
        (!retry &&
          (deferred.current === current.version || owner.failedVersion === current.version))
      )
        return false;
      owner.running = Promise.resolve().then(async () => {
        try {
          if ((await current.save()) === false) {
            deferred.current = current.version;
            return false;
          }
          owner.failedVersion = undefined;
          return true;
        } catch {
          owner.failedVersion = current.version;
          return false;
        } finally {
          owner.running = null;
          owner.notify();
        }
      });
      owner.notify();
      return owner.running;
    },
    [owner],
  );
  const initial = useRef(version);
  useLayoutEffect(() => {
    owner.editor = editor.current;
    initial.current = latest.current.version;
    return () => {
      // StrictMode replays and unedited restored drafts must wait for their
      // saved snapshot. Leaving a field after an edit counts as a blur.
      if (latest.current.version !== initial.current) void flush();
    };
  }, [owner, flush]);

  const saving = !!owner.running;
  const failed = dirty && owner.failedVersion === version;
  useEffect(() => {
    if (!dirty || !canSave || failed || saving || waitForBlur) return;
    const timer = setTimeout(() => void flush(), delay);
    return () => clearTimeout(timer);
  }, [version, dirty, canSave, failed, saving, waitForBlur, delay, flush]);
  const status: AutoSaveState = failed
    ? "failed"
    : saving
      ? "saving"
      : !dirty
        ? "saved"
        : !canSave
          ? "blocked"
          : waitForBlur
            ? "waiting"
            : "saving";
  return { status, failed, saving, retry: () => flush(true), flush };
}
