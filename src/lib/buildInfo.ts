/**
 * Build identity + "new version available" state.
 * BUILD_ID is stamped by vite.config.ts (define __BUILD_ID__) and the same id
 * is served at /version.json. The running app also compares its own entry
 * script (/assets/index-<hash>.js) with the one in a no-cache /index.html —
 * that works even when the host does not serve /version.json.
 */
import { create } from "zustand";
import { useEffect, useRef } from "react";

declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

/** A served id that is present and differs from ours means this tab is stale. */
export function isStaleBuild(current: string, served: string | null | undefined): boolean {
  return !!served && !!current && served.trim() !== current.trim();
}

/** Entry module path in an index.html, e.g. "/assets/index-AbC123.js". */
export function extractEntryScript(html: string | null | undefined): string | null {
  if (!html) return null;
  const m = html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i)
    || html.match(/<script[^>]*src=["']([^"']+)["'][^>]*type=["']module["']/i);
  if (!m) return null;
  try { return new URL(m[1], "http://x").pathname; } catch { return m[1]; }
}

/** Stale when both entries are hashed bundles and differ. Dev (/src/main.tsx) never counts. */
export function isStaleEntry(running: string | null | undefined, served: string | null | undefined): boolean {
  if (!running || !served) return false;
  if (!/\/assets\//.test(running) || !/\/assets\//.test(served)) return false;
  return running !== served;
}

/** The entry script this tab actually booted from. */
export function runningEntryScript(): string | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  if (!el) return null;
  try { return new URL(el.src, window.location.href).pathname; } catch { return el.getAttribute("src"); }
}

export const useBuildStatus = create<{ stale: boolean; latest: string | null; setLatest: (id: string | null) => void; markStale: (id: string) => void }>((set) => ({
  stale: false,
  latest: null,
  setLatest: (id) => set({ latest: id, stale: isStaleBuild(BUILD_ID, id) }),
  markStale: (id) => set({ latest: id, stale: true }),
}));

export const STALE_WRITE_MESSAGE = "I've been updated — please save and reload so I use the latest version.";

/** Read/navigate actions still run on an old bundle; anything that writes does not. */
const READ_ONLY = /^(open_|read_|show_|list_|find_|filter_|generate_quote_pdf$)/;
export function staleWriteRefusal(action: string | null | undefined, stale: boolean): string | null {
  if (!stale || !action) return null;
  return READ_ONLY.test(action) ? null : STALE_WRITE_MESSAGE;
}

export async function checkForNewBuild(fetcher: typeof fetch = fetch, running: string | null = runningEntryScript()): Promise<boolean> {
  const st = useBuildStatus.getState();
  if (st.stale) return true;
  try {
    const res = await fetcher(`/index.html?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const served = extractEntryScript(await res.text());
      if (isStaleEntry(running, served)) { st.markStale(served!); return true; }
    }
  } catch { /* offline */ }
  try {
    const res = await fetcher(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok && /json/i.test(res.headers?.get?.("content-type") || "")) {
      const j = (await res.json()) as { build_id?: string };
      if (typeof j.build_id === "string") useBuildStatus.getState().setLatest(j.build_id);
    }
  } catch { /* offline — keep current state */ }
  return useBuildStatus.getState().stale;
}

/** Soft reload: no cache clearing, no sign-out, no storage wipe. */
export const softReload = () => window.location.reload();

/** Editors with unsaved changes register here so a stale-build reload never loses work. */
const unsaved = new Set<string>();
export function setUnsavedChanges(key: string, dirty: boolean) { if (dirty) unsaved.add(key); else unsaved.delete(key); }
export const hasUnsavedChanges = () => unsaved.size > 0;
/** Hook helper: mark this editor dirty while `dirty` is true. */
export function useUnsavedFlag(dirty: boolean) {
  const key = useRef(Math.random().toString(36).slice(2)).current;
  useEffect(() => { setUnsavedChanges(key, dirty); return () => setUnsavedChanges(key, false); }, [key, dirty]);
}
