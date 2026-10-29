// The npm runtime also loads in browser previews; detect the native host channel.
export const isDesktop =
  typeof window !== "undefined" &&
  Boolean(
    Reflect.get(window, "chrome")?.webview ||
    Reflect.get(window, "webkit")?.messageHandlers?.external,
  );
