/**
 * V8 simple preview flag. Off unless someone turns it on for this browser.
 * Live screens do not read this. /v8 checks it and sends everyone else home.
 */
export const V8SIMPLE_STORAGE_KEY = "v8simple";

const envOn = () => {
  try {
    return (import.meta as { env?: { VITE_V8SIMPLE?: string } }).env?.VITE_V8SIMPLE === "1";
  } catch {
    return false;
  }
};

function readStore(store: Storage | undefined): boolean {
  try {
    return store?.getItem(V8SIMPLE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** True only for an explicit preview switch. Default is off. */
export function isV8SimpleEnabled(search?: string | URLSearchParams | null): boolean {
  const params = typeof search === "string"
    ? new URLSearchParams(search)
    : search instanceof URLSearchParams
      ? search
      : null;
  if (params?.get("v8simple") === "1") return true;
  if (envOn()) return true;
  if (typeof window === "undefined") return false;
  return readStore(window.localStorage) || readStore(window.sessionStorage);
}

/** Remember ?v8simple=1 so the rest of the preview keeps working after the query drops. */
export function rememberV8Simple(search?: string | URLSearchParams | null): void {
  const params = typeof search === "string"
    ? new URLSearchParams(search)
    : search instanceof URLSearchParams
      ? search
      : null;
  if (params?.get("v8simple") !== "1" || typeof window === "undefined") return;
  try { window.sessionStorage.setItem(V8SIMPLE_STORAGE_KEY, "1"); } catch { /* private mode */ }
}

/** Flag off: leave the preview. Flag on: show it. */
export function v8SimpleAccess(enabled: boolean): "open" | "redirect-home" {
  return enabled ? "open" : "redirect-home";
}
