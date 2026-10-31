import { lazy, type ComponentType } from "react";

// Stale lazy chunks after a deploy (Johan 31 Oct 16:11): an old index asks for chunk hashes that no longer exist.
// Fix: one automatic hard reload, guarded by a sessionStorage timestamp so it can never loop.
const KEY = "chunk-reload-at";
const WINDOW_MS = 30_000;

export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? "");
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(msg);
}

/** Reloads once. Returns false when we already reloaded within 30s (then the caller shows the error screen). */
export function reloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (last && Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked: still reload once per page load */
    if ((window as unknown as { __chunkReloaded?: boolean }).__chunkReloaded) return false;
    (window as unknown as { __chunkReloaded?: boolean }).__chunkReloaded = true;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_r", String(Date.now()));
  window.location.replace(url.toString());
  return true;
}

export function installChunkReload() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForStaleChunk()) event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) reloadOnceForStaleChunk();
  });
  // Drop the cache-buster from the address bar after a successful load.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("_r")) {
      url.searchParams.delete("_r");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    /* ignore */
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries a dynamic import (network blips), then falls back to one guarded hard reload. */
export async function importWithRetry<T>(factory: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await factory();
    } catch (err) {
      lastErr = err;
      if (i < retries) await wait(400 * (i + 1));
    }
  }
  if (isChunkLoadError(lastErr) && reloadOnceForStaleChunk()) return new Promise<T>(() => {});
  throw lastErr;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => importWithRetry(factory));
}
