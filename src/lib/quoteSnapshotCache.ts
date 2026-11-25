/**
 * Last quote the editor had on screen, so opening it again paints the lines
 * immediately. A silent refetch still replaces this with the server copy
 * unless the person has edited since that fetch started.
 * Off during unit tests so a previous case cannot seed the next one.
 */

type Snap = { meta: unknown; areas: unknown[]; items: unknown[] };

const MAX = 8;
const store = new Map<string, Snap>();
const order: string[] = [];
let enabledOverride: boolean | null = null;

function enabled() {
  if (enabledOverride != null) return enabledOverride;
  return import.meta.env.MODE !== "test";
}

/** Test-only switch. Pass null to follow the normal mode check, false to wipe. */
export function setQuoteSnapshotCacheEnabled(on: boolean | null) {
  enabledOverride = on;
  if (!on) {
    store.clear();
    order.length = 0;
  }
}

export function readQuoteSnapshot<T>(quoteId: string): T | null {
  if (!enabled() || !quoteId) return null;
  return (store.get(quoteId) as T | undefined) ?? null;
}

export function rememberQuoteSnapshot(quoteId: string, snap: Snap) {
  if (!enabled() || !quoteId || snap.meta == null) return;
  // An empty picture is not worth keeping. A failed load used to be remembered
  // as "no areas, R0" and painted again on the next open. A real empty quote just refetches.
  if ((snap.areas?.length ?? 0) === 0 && (snap.items?.length ?? 0) === 0) {
    store.delete(quoteId);
    const at = order.indexOf(quoteId);
    if (at >= 0) order.splice(at, 1);
    return;
  }
  store.delete(quoteId);
  store.set(quoteId, {
    meta: snap.meta,
    areas: snap.areas ?? [],
    items: snap.items ?? [],
  });
  const at = order.indexOf(quoteId);
  if (at >= 0) order.splice(at, 1);
  order.push(quoteId);
  while (order.length > MAX) {
    const oldest = order.shift();
    if (oldest) store.delete(oldest);
  }
}
