import { backend, isDesktop, message, type UpdateStatus } from "@/lib/backend";
import { Events } from "@wailsio/runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ReadyRelease = {
  ready: boolean;
  version?: string;
};

function applyReadyStatus(
  status: UpdateStatus,
  readyRelease: ReadyRelease,
  previous?: UpdateStatus | null,
): UpdateStatus {
  const ready = status.ready || readyRelease.ready || Boolean(previous?.ready);
  if (!ready) return status;
  return {
    ...status,
    currentVersion: status.currentVersion || previous?.currentVersion || "",
    latestVersion: readyRelease.version || status.latestVersion || previous?.latestVersion || "",
    available: true,
    ready: true,
    checkedAt: status.checkedAt || previous?.checkedAt || "",
    notes: status.notes || previous?.notes || "",
    error: "",
  };
}

function fallbackReadyStatus(version = ""): UpdateStatus {
  return {
    currentVersion: "",
    latestVersion: version,
    available: true,
    ready: true,
    supported: true,
    configured: true,
    checkedAt: "",
    notes: "",
    error: "",
    message: "",
  };
}

export function useAppUpdateState(loading: boolean) {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(isDesktop);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const mounted = useRef(false);
  const bootstrapped = useRef(false);
  const updateRequest = useRef(false);
  const readyRelease = useRef<ReadyRelease>({ ready: false });

  const commitStatus = useCallback((status: UpdateStatus) => {
    if (status.ready) {
      readyRelease.current = {
        ready: true,
        version: readyRelease.current.version || status.latestVersion,
      };
    }
    const next = applyReadyStatus(status, readyRelease.current);
    if (!mounted.current) return next;
    setUpdate((previous) => applyReadyStatus(next, readyRelease.current, previous));
    setUpdateError(next.error);
    return next;
  }, []);

  const checkUpdates = useCallback(
    async (manual = true) => {
      if (!isDesktop || updateRequest.current) return;
      if (manual && readyRelease.current.ready) return;
      bootstrapped.current = true;
      updateRequest.current = true;
      setCheckingUpdates(true);
      setUpdateError("");
      let hydrated: UpdateStatus | null = null;
      try {
        if (!manual) {
          try {
            hydrated = await backend.updateStatus();
          } catch {
            hydrated = null;
          }
          if (hydrated && (hydrated.ready || readyRelease.current.ready)) {
            commitStatus(hydrated);
            return;
          }
          if (readyRelease.current.ready) return;
        }
        const value = await backend.checkUpdates(manual);
        commitStatus(value);
      } catch (cause) {
        const fallback = await backend.updateStatus().catch(() => hydrated);
        if (fallback) {
          const next = commitStatus(fallback);
          if (next.ready) return;
        }
        if (mounted.current) {
          setUpdateError(readyRelease.current.ready ? "" : message(cause));
        }
      } finally {
        updateRequest.current = false;
        if (mounted.current) setCheckingUpdates(false);
      }
    },
    [commitStatus],
  );

  const installUpdate = useCallback(async () => {
    if (!isDesktop || updateRequest.current) return;
    const restarting = Boolean(update?.ready || readyRelease.current.ready);
    updateRequest.current = true;
    setInstallingUpdate(true);
    setUpdateError("");
    try {
      if (restarting) await backend.restartUpdate();
      else {
        await backend.installUpdate();
        const value = await backend.updateStatus().catch(() => null);
        if (value) commitStatus(value);
      }
    } catch (cause) {
      if (!restarting) {
        const fallback = await backend.updateStatus().catch(() => null);
        if (fallback) {
          const next = commitStatus(fallback);
          if (next.ready) return;
        }
        if (readyRelease.current.ready) {
          if (mounted.current) setUpdateError("");
          return;
        }
      }
      if (mounted.current) {
        setUpdateError(message(cause));
      }
    } finally {
      updateRequest.current = false;
      if (mounted.current) setInstallingUpdate(false);
    }
  }, [commitStatus, update?.ready]);

  useEffect(() => {
    mounted.current = true;
    if (!isDesktop) {
      return () => {
        mounted.current = false;
      };
    }
    const off = Events.On("wails:updater:update-ready", (event) => {
      const release = event.data as { version?: string } | undefined;
      readyRelease.current = {
        ready: true,
        version: release?.version || readyRelease.current.version,
      };
      setUpdate((value) =>
        applyReadyStatus(
          value ?? fallbackReadyStatus(readyRelease.current.version),
          readyRelease.current,
          value,
        ),
      );
      setUpdateError("");
      if (!updateRequest.current) {
        void backend
          .updateStatus()
          .then((status) => {
            if (status) commitStatus(status);
          })
          .catch(() => {});
      }
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, [commitStatus]);

  useEffect(() => {
    if (isDesktop && !loading && !bootstrapped.current) void checkUpdates(false);
  }, [loading, checkUpdates]);

  return useMemo(
    () => ({ update, checkingUpdates, installingUpdate, updateError, checkUpdates, installUpdate }),
    [update, checkingUpdates, installingUpdate, updateError, checkUpdates, installUpdate],
  );
}
