import { useEffect, useRef, useState } from "react";

export type AutoSaveState = "saved" | "saving" | "waiting" | "blocked" | "failed";

export function useAutoSave({
  draftKey,
  dirty,
  canSave,
  save,
  delay = 400,
  waitForBlur = false,
}: {
  draftKey: string;
  dirty: boolean;
  canSave: boolean;
  save: () => Promise<void | boolean>;
  delay?: number;
  waitForBlur?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const completed = useRef<string | null>(null);
  const deferred = useRef<string | null>(null);
  const latest = useRef({ draftKey, dirty, canSave, save, waitForBlur });
  latest.current = { draftKey, dirty, canSave, save, waitForBlur };
  const mountedDraft = useRef(draftKey);
  const mounted = useRef(true);
  const failed = dirty && failedDraft === draftKey;

  async function flush(retry = false): Promise<boolean> {
    // A close can arrive during a save. Wait, then flush any newer edits too.
    if (running.current) {
      if (!(await running.current)) return false;
      return flush(retry);
    }
    const value = latest.current;
    if (!value.dirty || completed.current === value.draftKey) return true;
    if (!retry && deferred.current === value.draftKey) return false;
    if (!value.canSave || (!retry && failedDraft === value.draftKey)) return false;
    if (mounted.current) setSaving(true);
    const task = (async () => {
      try {
        if ((await value.save()) === false) {
          deferred.current = value.draftKey;
          return false;
        }
        deferred.current = null;
        completed.current = value.draftKey;
        if (mounted.current) setFailedDraft(null);
        return true;
      } catch {
        if (mounted.current) setFailedDraft(value.draftKey);
        return false;
      } finally {
        running.current = null;
        if (mounted.current) setSaving(false);
      }
    })();
    running.current = task;
    return task;
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    if (deferred.current !== draftKey) deferred.current = null;
    if (!dirty) {
      setFailedDraft(null);
      completed.current = null;
      deferred.current = null;
    }
  }, [dirty, draftKey]);
  useEffect(() => {
    if (!dirty || !canSave || failed || saving || waitForBlur) return;
    const timer = setTimeout(() => void flushRef.current(), delay);
    return () => clearTimeout(timer);
  }, [draftKey, dirty, canSave, failed, saving, waitForBlur, delay]);
  useEffect(() => {
    mounted.current = true;
    const initialDraft = mountedDraft.current;
    return () => {
      mounted.current = false;
      const value = latest.current;
      // A restored draft must first reconcile against fresh backend state.
      if (value.draftKey !== initialDraft && !value.waitForBlur) void flushRef.current();
    };
  }, []);
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
  return { status, failed, saving, retry: () => flush(true), flush: () => flush() };
}
