import { useEffect, useState } from "react";

/**
 * Live client preview next to the quote editor (Johan 14 Oct 2026).
 * Open/closed is remembered per user in localStorage; every hook instance stays in sync.
 */
const EVENT = "fls-live-preview-pref";
export const livePreviewKey = (userId?: string | null) => `fls.quote.livePreview.${userId || "anon"}`;

function read(key: string): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? true : v === "1";
  } catch {
    return true;
  }
}

export function useLivePreviewPref(userId?: string | null): [boolean, (open: boolean) => void] {
  const key = livePreviewKey(userId);
  const [open, setOpen] = useState<boolean>(() => (typeof window === "undefined" ? true : read(key)));
  useEffect(() => {
    setOpen(read(key));
    const sync = () => setOpen(read(key));
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, [key]);
  const set = (next: boolean) => {
    try { window.localStorage.setItem(key, next ? "1" : "0"); } catch { /* private mode */ }
    setOpen(next);
    window.dispatchEvent(new Event(EVENT));
  };
  return [open, set];
}

/** Wide screens (>= 1280px) get the side-by-side pane; narrower screens get the Editor | Client view toggle. */
export function useIsWideScreen(minWidth = 1280): boolean {
  const q = `(min-width: ${minWidth}px)`;
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
  const [wide, setWide] = useState<boolean>(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [q]);
  return wide;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
