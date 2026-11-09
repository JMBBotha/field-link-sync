/**
 * Admin Home section layout (order, hidden, pinned).
 * Per-browser choice in localStorage. Hiding never deletes a section.
 * Defaults: Earlier home detail, All next steps, More details — all visible, all collapsed.
 */
export const ADMIN_HOME_BLOCK_IDS = ["earlier", "next", "details"] as const;
export type AdminHomeBlockId = (typeof ADMIN_HOME_BLOCK_IDS)[number];

export const ADMIN_HOME_BLOCKS_KEY = "fls.adminHome.blocks";
export const ADMIN_HOME_BLOCKS_EVENT = "fls-admin-home-blocks";

export interface AdminHomeBlockMeta {
  title: string;
  testId: string;
  /** Collapsed bar. Pinned sections do not use this chrome. */
  detailsClass: string;
}

export const ADMIN_HOME_BLOCK_META: Record<AdminHomeBlockId, AdminHomeBlockMeta> = {
  earlier: {
    title: "Earlier home detail",
    testId: "home-earlier-detail",
    detailsClass: "rounded-2xl border bg-card/95 p-2",
  },
  next: {
    title: "All next steps (filter, snooze)",
    testId: "home-all-next-steps",
    detailsClass: "v7-solid rounded-2xl border bg-card p-2",
  },
  details: {
    title: "More details (gauges, funnel, comparisons)",
    testId: "v8-home-details",
    detailsClass: "v7-solid rounded-2xl border bg-card p-2",
  },
};

export interface AdminHomeBlockPrefs {
  order: AdminHomeBlockId[];
  hidden: AdminHomeBlockId[];
  pinned: AdminHomeBlockId[];
}

export const DEFAULT_ADMIN_HOME_BLOCKS: AdminHomeBlockPrefs = {
  order: ["earlier", "next", "details"],
  hidden: [],
  pinned: [],
};

function isBlockId(value: unknown): value is AdminHomeBlockId {
  return value === "earlier" || value === "next" || value === "details";
}

function uniqueIds(values: unknown): AdminHomeBlockId[] {
  if (!Array.isArray(values)) return [];
  const out: AdminHomeBlockId[] = [];
  for (const value of values) {
    if (isBlockId(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Drop unknown ids, fill anything missing, and keep a stable order. */
export function normalizeAdminHomeBlocks(raw: unknown): AdminHomeBlockPrefs {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const order = uniqueIds(src.order);
  for (const id of ADMIN_HOME_BLOCK_IDS) {
    if (!order.includes(id)) order.push(id);
  }
  return {
    order,
    hidden: uniqueIds(src.hidden),
    pinned: uniqueIds(src.pinned),
  };
}

export function freshAdminHomeBlocks(): AdminHomeBlockPrefs {
  return normalizeAdminHomeBlocks(DEFAULT_ADMIN_HOME_BLOCKS);
}

export function readAdminHomeBlocks(key = ADMIN_HOME_BLOCKS_KEY): AdminHomeBlockPrefs {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return freshAdminHomeBlocks();
    return normalizeAdminHomeBlocks(JSON.parse(raw));
  } catch {
    return freshAdminHomeBlocks();
  }
}

export function writeAdminHomeBlocks(key: string, prefs: AdminHomeBlockPrefs): AdminHomeBlockPrefs {
  const clean = normalizeAdminHomeBlocks(prefs);
  try { localStorage.setItem(key, JSON.stringify(clean)); } catch { /* private mode */ }
  return clean;
}

export function visibleAdminHomeBlocks(prefs: AdminHomeBlockPrefs): AdminHomeBlockId[] {
  const hidden = new Set(prefs.hidden);
  return prefs.order.filter((id) => !hidden.has(id));
}

export function reorderAdminHomeBlocks(prefs: AdminHomeBlockPrefs, activeId: string, overId: string): AdminHomeBlockPrefs {
  const order = prefs.order.slice();
  const from = order.indexOf(activeId as AdminHomeBlockId);
  const to = order.indexOf(overId as AdminHomeBlockId);
  if (from < 0 || to < 0 || from === to) return prefs;
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item);
  return normalizeAdminHomeBlocks({ ...prefs, order });
}

export function setAdminHomeBlockHidden(prefs: AdminHomeBlockPrefs, id: AdminHomeBlockId, hidden: boolean): AdminHomeBlockPrefs {
  const next = hidden
    ? [...prefs.hidden.filter((item) => item !== id), id]
    : prefs.hidden.filter((item) => item !== id);
  return normalizeAdminHomeBlocks({ ...prefs, hidden: next });
}

export function setAdminHomeBlockPinned(prefs: AdminHomeBlockPrefs, id: AdminHomeBlockId, pinned: boolean): AdminHomeBlockPrefs {
  const next = pinned
    ? [...prefs.pinned.filter((item) => item !== id), id]
    : prefs.pinned.filter((item) => item !== id);
  return normalizeAdminHomeBlocks({ ...prefs, pinned: next });
}
