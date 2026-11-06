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
      return methods[name](...args.args);
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
    "setup:changed",
    "profile:changed",
    "shortcut:capture-ended",
    "indicator:frame",
  ]) {
    events?.subscribe?.(name, (...args) => dispatch(name, args.length > 1 ? args : args[0]));
  }
  events?.onFileDrop?.((_x, _y, paths) => dispatch("audio:files-dropped", paths));
}
