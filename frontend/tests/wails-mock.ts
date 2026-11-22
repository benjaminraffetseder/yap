// Loaded by Vite only in ui-test mode. Fixtures describe backend methods;
// calls and event listeners still pass through the real Wails v3 runtime.
import { setTransport } from "@wailsio/runtime";

const methods = Reflect.get(window, "mockBackend")?.app?.App as
  Record<string, (...args: unknown[]) => unknown> | undefined;
const events = Reflect.get(window, "mockEvents") as
  | {
      subscribe?: (name: string, callback: (...args: unknown[]) => void) => void;
      onFileDrop?: (callback: (x: number, y: number, paths: string[]) => void) => void;
      ClipboardSetText?: (text: string) => Promise<boolean>;
      emit?: (name: string, data: unknown) => boolean;
    }
  | undefined;

if (methods) {
  // Let application detection see the same native channel as WebView2.
  const chrome = Reflect.get(window, "chrome") ?? {};
  chrome.webview = { postMessage() {} };
  Reflect.set(window, "chrome", chrome);

  const fields = {
    GetConfiguration: [
      "settings",
      "textProcessing",
      "appProfileRules",
      "profileShortcut",
      "dictationProfiles",
      "activeProfileId",
      "defaultProfileId",
      "profileModified",
      "ready",
    ],
    GetModelCatalog: ["models", "textModels", "textRuntimeAvailable", "recommendedTextContext"],
    GetRuntimeSnapshot: [
      "status",
      "bulkTextQueue",
      "importQueue",
      "recordingSaveHistory",
      "latestResult",
      "diagnostic",
      "microphoneTested",
      "shortcutTested",
      "dataDir",
      "floatingIndicator",
      "launchAtLoginAvailable",
      "startInTrayAvailable",
    ],
  };
  for (const [name, keys] of Object.entries(fields)) {
    if (!methods[name])
      methods[name] = async () => {
        const snapshot = await methods.GetSnapshot();
        return Object.fromEntries(keys.map((key) => [key, Reflect.get(snapshot as object, key)]));
      };
  }
  if (!methods.GetVocabulary)
    methods.GetVocabulary = async () =>
      Reflect.get((await methods.GetSnapshot()) as object, "vocabulary");
  if (!methods.GetRecentHistory)
    methods.GetRecentHistory = async () =>
      ((await methods.GetSnapshot()) as { history?: { deletedAt?: string }[] }).history
        ?.filter((entry) => !entry.deletedAt)
        .slice(0, 5) ?? [];
  if (!methods.GetAudioURL) methods.GetAudioURL = (...args: unknown[]) => methods.GetAudio(...args);
  if (!methods.PermanentlyDeleteSessionsWithResult)
    methods.PermanentlyDeleteSessionsWithResult = async (ids: unknown) => {
      await methods.PermanentlyDeleteSessions(ids);
      return { deletedIds: ids, error: "" };
    };
  if (!methods.GetHistorySelectionIDs)
    methods.GetHistorySelectionIDs = async (query: unknown) => {
      // Existing fixtures own their complete paginated History collection.
      // Reuse it for this additive read instead of an unrelated export preview.
      const ids: string[] = [];
      for (let page = 0; ; page++) {
        const result = (await methods.GetHistory(query, page)) as {
          entries?: { id: string }[];
          total?: number;
          pageSize?: number;
        };
        ids.push(...(result.entries ?? []).map((entry) => entry.id));
        if ((page + 1) * (result.pageSize ?? 50) >= (result.total ?? 0)) return ids;
      }
    };

  setTransport({
    async call(objectID, method, _windowName, args) {
      // Complete the native Wails WindowFilesDropped round trip.
      if (objectID === 6 && method === 50) {
        Reflect.get(window, "_wails").dispatchWailsEvent({
          name: "audio:files-dropped",
          data: args.filenames,
        });
        return;
      }
      if (objectID === 3) return events?.emit?.(args.name, args.data) ?? false;
      if (objectID === 1) {
        if (!(await events?.ClipboardSetText?.(args.text)))
          throw new Error("Clipboard unavailable");
        return;
      }
      if (objectID !== 0) return null;
      if (!String(args.methodName).startsWith("yap/internal/app.App."))
        throw new ReferenceError(`Unknown service method: ${args.methodName}`);
      const name = String(args.methodName).split(".").at(-1)!;
      if (name === "SetIndicatorTheme" && !methods[name]) return;
      if (typeof methods[name] !== "function") throw new ReferenceError(`Unknown method: ${name}`);
      // Native responses cross a serialization boundary. Returning a fixture's
      // live object lets simulated backend writes silently mutate Query's cache.
      return structuredClone(await methods[name](...args.args));
    },
  });

  const dispatch = (name: string, data: unknown) =>
    Reflect.get(window, "_wails").dispatchWailsEvent({ name, data });
  for (const name of [
    "dictation:status",
    "dictation:level",
    "dictation:history",
    "desktop:navigate",
    "import:queue",
    "text:queue",
    "chat:progress",
    "chat:changed",
    "chat:voice",
    "setup:changed",
    "profile:changed",
    "shortcut:capture-ended",
    "indicator:frame",
    "wails:updater:update-ready",
  ]) {
    events?.subscribe?.(name, (...args) => dispatch(name, args.length > 1 ? args : args[0]));
  }
  events?.onFileDrop?.((_x, _y, paths) => dispatch("audio:files-dropped", paths));
}
