import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const preference = window.matchMedia(query);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(query).matches;
}

// Motion's hook snapshots the preference at mount; keep our variants responsive to OS changes too.
export function useMotionPreference() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
