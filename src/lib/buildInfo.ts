/**
 * Build identity + "new version available" state.
 * BUILD_ID is stamped by vite.config.ts (define __BUILD_ID__) and the same id
 * is served at /version.json. The app polls it; a different id = stale bundle.
 */
import { create } from "zustand";

declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

/** A served id that is present and differs from ours means this tab is stale. */
export function isStaleBuild(current: string, served: string | null | undefined): boolean {
  return !!served && !!current && served.trim() !== current.trim();
}

export const useBuildStatus = create<{ stale: boolean; latest: string | null; setLatest: (id: string | null) => void }>((set) => ({
  stale: false,
  latest: null,
  setLatest: (id) => set({ latest: id, stale: isStaleBuild(BUILD_ID, id) }),
}));

export const STALE_WRITE_MESSAGE = "I've been updated — tap Update first.";

/** Read/navigate actions still run on an old bundle; anything that writes does not. */
const READ_ONLY = /^(open_|read_|show_|list_|find_|filter_|generate_quote_pdf$)/;
export function staleWriteRefusal(action: string | null | undefined, stale: boolean): string | null {
  if (!stale || !action) return null;
  return READ_ONLY.test(action) ? null : STALE_WRITE_MESSAGE;
}

export async function checkForNewBuild(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return useBuildStatus.getState().stale;
    const j = (await res.json()) as { build_id?: string };
    useBuildStatus.getState().setLatest(typeof j.build_id === "string" ? j.build_id : null);
  } catch { /* offline — keep current state */ }
  return useBuildStatus.getState().stale;
}

/** Soft reload: no cache clearing, no sign-out, no storage wipe. */
export const softReload = () => window.location.reload();
