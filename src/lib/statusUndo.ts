/**
 * Session "undo last status change" (Release D3).
 * sessionStorage stack per user, max 20. Pure helpers + a tiny store.
 * Leads are logged by the DB trigger log_lead_status_change — never log them here.
 */
export type UndoEntityType = "lead" | "job" | "quote";

export type StatusUndoEntry = {
  id: string;
  entity_type: UndoEntityType;
  entity_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  /** Extra columns to restore on revert (e.g. accepted_at/accepted_by/declined_at). */
  extra_restore?: Record<string, unknown>;
  /** Human label, e.g. "Q-1234". */
  label?: string;
  company_id?: string | null;
  at: string;
};

export const UNDO_LIMIT = 20;
export const UNDO_KEY_PREFIX = "status-undo:";
export const UNDO_EVENT = "status-undo-changed";
export const undoKey = (userId: string) => `${UNDO_KEY_PREFIX}${userId}`;

export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem"> & { length?: number; key?: (i: number) => string | null };

// ───────── pure stack ops ─────────
export function pushEntry(stack: StatusUndoEntry[], e: StatusUndoEntry, limit = UNDO_LIMIT): StatusUndoEntry[] {
  return [...stack, e].slice(-limit);
}
export function peekEntry(stack: StatusUndoEntry[]): StatusUndoEntry | null {
  return stack.length ? stack[stack.length - 1] : null;
}
export function removeEntry(stack: StatusUndoEntry[], id: string): StatusUndoEntry[] {
  return stack.filter((e) => e.id !== id);
}

/** Revert only if the entity still holds the value we set. */
export function isStale(currentValue: string | null | undefined, e: StatusUndoEntry): boolean {
  return (currentValue ?? null) !== (e.new_value ?? null);
}

export function buildRevertPatch(e: StatusUndoEntry): Record<string, unknown> {
  return { [e.field]: e.old_value, ...(e.extra_restore || {}) };
}

export function buildRevertLog(e: StatusUndoEntry, changedBy: string) {
  if (e.entity_type === "lead") return null; // trigger already logs leads
  if (!e.company_id) return null;
  return {
    entity_type: e.entity_type,
    entity_id: e.entity_id,
    field_name: e.field,
    old_status: e.new_value,
    new_status: e.old_value,
    changed_by: changedBy,
    company_id: e.company_id,
  };
}

export function describeEntry(e: StatusUndoEntry): string {
  const f = (v: string | null) => (v ?? "none").replace(/_/g, " ");
  return `Undo: ${e.label || e.entity_type} ${f(e.new_value)} → ${f(e.old_value)}`;
}

export const tableFor = (t: UndoEntityType) => (t === "lead" ? "leads" : t === "job" ? "jobs" : "quotes");

// ───────── storage ─────────
const defaultKV = (): KV | null => (typeof window !== "undefined" ? window.sessionStorage : null);

export function readStack(userId: string | null, kv: KV | null = defaultKV()): StatusUndoEntry[] {
  if (!userId || !kv) return [];
  try { return JSON.parse(kv.getItem(undoKey(userId)) || "[]"); } catch { return []; }
}
export function writeStack(userId: string, stack: StatusUndoEntry[], kv: KV | null = defaultKV()) {
  if (!kv) return;
  kv.setItem(undoKey(userId), JSON.stringify(stack));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UNDO_EVENT));
}
export function recordStatusChange(userId: string | null, e: Omit<StatusUndoEntry, "id" | "at">, kv: KV | null = defaultKV()): StatusUndoEntry | null {
  if (!userId || (e.old_value ?? null) === (e.new_value ?? null)) return null;
  const entry: StatusUndoEntry = { ...e, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString() };
  writeStack(userId, pushEntry(readStack(userId, kv), entry), kv);
  return entry;
}
export function dropEntry(userId: string, id: string, kv: KV | null = defaultKV()) {
  writeStack(userId, removeEntry(readStack(userId, kv), id), kv);
}
/** Sign-out: clear every user's stack in this tab. */
export function clearAllStacks(kv: KV | null = defaultKV()) {
  if (!kv || !kv.key || kv.length == null) return;
  const keys: string[] = [];
  for (let i = 0; i < kv.length; i++) { const k = kv.key(i); if (k?.startsWith(UNDO_KEY_PREFIX)) keys.push(k); }
  keys.forEach((k) => kv.removeItem(k));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UNDO_EVENT));
}
