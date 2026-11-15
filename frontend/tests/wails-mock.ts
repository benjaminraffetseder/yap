// Loaded by Vite only in ui-test mode. Fixtures describe backend methods;
// calls and event listeners still pass through the real Wails v3 runtime.
import { setTransport } from "@wailsio/runtime";

const methods = Reflect.get(window, "mockBackend")?.main?.App as
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
      "history",
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

  setTransport({
    async call(objectID, _method, _windowName, args) {
      if (objectID === 3) return events?.emit?.(args.name, args.data) ?? false;
      if (objectID === 1) {
        if (!(await events?.ClipboardSetText?.(args.text)))
          throw new Error("Clipboard unavailable");
        return;
      }
      if (objectID !== 0) return null;
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
