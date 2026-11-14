import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { backend, isDesktop, message, type UpdateStatus } from "@/lib/backend";

export function useAppUpdateState(loading: boolean) {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const updateRequest = useRef(false);
  const checkUpdates = useCallback(async (manual = true) => {
    if (!isDesktop || updateRequest.current) return;
    updateRequest.current = true;
    setCheckingUpdates(true);
    setUpdateError("");
    try {
      const value = await backend.checkUpdates(manual);
      setUpdate(value);
      setUpdateError(value.error);
    } catch (cause) {
      setUpdateError(message(cause));
    } finally {
      updateRequest.current = false;
      setCheckingUpdates(false);
    }
  }, []);
  const installUpdate = useCallback(async () => {
    if (!isDesktop || updateRequest.current) return;
    updateRequest.current = true;
    setInstallingUpdate(true);
    setUpdateError("");
    try {
      if (update?.ready) await backend.restartUpdate();
      else {
        await backend.installUpdate();
        const value = await backend.updateStatus();
        setUpdate(value);
        setUpdateError(value.error);
      }
    } catch (cause) {
      setUpdateError(message(cause));
    } finally {
      updateRequest.current = false;
      setInstallingUpdate(false);
    }
  }, [update?.ready]);
  useEffect(() => {
    if (isDesktop && !loading) void checkUpdates(false);
  }, [loading, checkUpdates]);
  useEffect(() => {
    if (!isDesktop) return;
    return Events.On("wails:updater:update-ready", (event) => {
      const release = event.data as { version?: string } | undefined;
      setUpdate(
        (value) =>
          value && {
            ...value,
            available: true,
            ready: true,
            latestVersion: release?.version ?? value.latestVersion,
          },
      );
      setUpdateError("");
    });
  }, []);
  return useMemo(
    () => ({ update, checkingUpdates, installingUpdate, updateError, checkUpdates, installUpdate }),
    [update, checkingUpdates, installingUpdate, updateError, checkUpdates, installUpdate],
  );
}
