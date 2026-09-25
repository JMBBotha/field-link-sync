/**
 * Write → refresh → verify. Every Mandy write refreshes the open page and only
 * claims success on screen when the refreshed data actually shows the change.
 */
import type { MandyResult } from "./actions";

export interface RefreshDeps<S> {
  /** Re-read the live quote (QuoteContext.refetch). */
  refetch?: () => Promise<S | null>;
  /** Invalidate react-query caches for this record (document, items, totals…). */
  invalidate?: () => void | Promise<unknown>;
  onChanged?: () => void;
}

export async function refreshAfterMandyWrite<S>(d: RefreshDeps<S>): Promise<S | null> {
  try { await d.invalidate?.(); } catch { /* ignore */ }
  d.onChanged?.();
  try { return (await d.refetch?.()) ?? null; } catch { return null; }
}

const CLAIM_RE = /\b(done|now visible|opened|it'?s open|is open)\b/i;
export const UNVERIFIED_SUFFIX = "I couldn't confirm it on screen yet.";

/** Enforce honest replies: no "done/opened" claim unless verified. */
export function honestMessage(r: MandyResult): string {
  if (r.verified !== false) return r.message;
  const m = r.message.replace(/\bOpened\b/g, "Tried to open").replace(CLAIM_RE, "sent");
  return `${m.replace(/\s*$/, "")} ${UNVERIFIED_SUFFIX}`.trim();
}

/** Did the route actually change to (or already sit on) the target path? */
export function routeReached(target: string, pathname: string, search = ""): boolean {
  const [p, q] = target.split("?");
  if (pathname !== p) return false;
  if (!q) return true;
  const want = new URLSearchParams(q);
  const have = new URLSearchParams(search);
  return [...want.entries()].every(([k, v]) => have.get(k) === v);
}
