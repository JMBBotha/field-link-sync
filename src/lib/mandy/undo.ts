/**
 * Undo the last Mandy change. Before every Mandy write (or a confirmed plan,
 * as one unit) the whole quote is snapshotted into mandy_undo_snapshots:
 * items, areas, notes and totals, plus a hash of the state AFTER the write.
 * Undo restores only when the current state still hashes to that value, so
 * any hand edit (or non-Mandy change) since then blocks it. Consecutive undos
 * chain naturally: after restoring, the state equals the previous snapshot's
 * "after" state.
 */
import { supabase } from "@/integrations/supabase/client";

export const MANUAL_EDIT_REFUSAL = "You've edited the quote by hand since then, so I can't undo safely.";

type Row = Record<string, any>;
export interface QuoteSnapshot {
  quote: { notes: string | null; subtotal?: number | null; vat_amount?: number | null; total?: number | null };
  areas: Row[];
  items: Row[];
}

const AREA_KEYS = ["id", "name", "description", "sort_order"] as const;
const ITEM_KEYS = [
  "id", "area_id", "parent_item_id", "product_id", "item_name", "item_number", "description", "quantity",
  "length", "unit_price", "total_price", "is_bundle", "item_type", "metadata", "sort_order", "notes", "source", "supplier",
] as const;
const pick = (r: Row, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function stable(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(Number(v.toFixed(4)));
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v as Row).sort().map((k) => `${k}:${stable((v as Row)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

function normItem(r: Row) {
  const o = pick(r, ITEM_KEYS);
  o.quantity = num(o.quantity); o.length = num(o.length); o.unit_price = num(o.unit_price); o.total_price = num(o.total_price);
  o.sort_order = num(o.sort_order); o.is_bundle = !!o.is_bundle; o.metadata = o.metadata || {};
  return o;
}
function normArea(r: Row) { const o = pick(r, AREA_KEYS); o.sort_order = num(o.sort_order); return o; }

export function captureSnapshot(meta: Row | null | undefined, areas: Row[], items: Row[]): QuoteSnapshot {
  return {
    quote: { notes: meta?.notes ?? null, subtotal: num(meta?.subtotal), vat_amount: num(meta?.vat_amount), total: num(meta?.total) },
    areas: areas.map(normArea),
    items: items.map(normItem),
  };
}

/** Hash of items + areas + quote notes (timestamps excluded). */
export function stateHash(notes: string | null | undefined, areas: Row[], items: Row[]): string {
  const s = stable({
    notes: notes || null,
    areas: areas.map(normArea).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    items: items.map(normItem).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  });
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}:${s.length}`;
}

export type UndoDecision = { ok: true } | { ok: false; message: string };
export function undoDecision(o: { status?: string | null; snap: { state_hash_after?: string | null } | null; currentHash: string }): UndoDecision {
  if (o.status && o.status !== "draft") return { ok: false, message: `This quote is ${o.status}, so I can only undo on drafts.` };
  if (!o.snap) return { ok: false, message: "There's no Mandy change to undo on this quote." };
  if (!o.snap.state_hash_after || o.snap.state_hash_after !== o.currentHash) return { ok: false, message: MANUAL_EDIT_REFUSAL };
  return { ok: true };
}

export interface RestorePlan {
  deleteItems: string[]; deleteAreas: string[];
  insertAreas: Row[]; updateAreas: Row[];
  insertItems: Row[]; updateItems: Row[];
  notesChanged: boolean;
}
/** Pure diff: current → snapshot. Parents are inserted before children. */
export function planRestore(snap: QuoteSnapshot, cur: { notes: string | null; areas: Row[]; items: Row[] }): RestorePlan {
  const sA = new Map(snap.areas.map((a) => [a.id, a])), cA = new Map(cur.areas.map((a) => [a.id, normArea(a)]));
  const sI = new Map(snap.items.map((i) => [i.id, i])), cI = new Map(cur.items.map((i) => [i.id, normItem(i)]));
  const diff = (a: Row, b: Row) => stable(a) !== stable(b);
  const insertItems = snap.items.filter((i) => !cI.has(i.id))
    .sort((a, b) => (a.parent_item_id ? 1 : 0) - (b.parent_item_id ? 1 : 0));
  return {
    deleteItems: cur.items.filter((i) => !sI.has(i.id)).sort((a, b) => (b.parent_item_id ? 1 : 0) - (a.parent_item_id ? 1 : 0)).map((i) => i.id),
    deleteAreas: cur.areas.filter((a) => !sA.has(a.id)).map((a) => a.id),
    insertAreas: snap.areas.filter((a) => !cA.has(a.id)),
    updateAreas: snap.areas.filter((a) => cA.has(a.id) && diff(a, cA.get(a.id)!)),
    insertItems,
    updateItems: snap.items.filter((i) => cI.has(i.id) && diff(i, cI.get(i.id)!)),
    notesChanged: (snap.quote.notes || null) !== (cur.notes || null),
  };
}

/* ───── persistence ───── */
export interface SnapshotRow { id: string; action: string; label: string | null; snapshot: QuoteSnapshot; state_hash_after: string | null; created_at: string }
const T = () => (supabase as any).from("mandy_undo_snapshots");

export async function saveUndoSnapshot(r: { quoteId: string; action: string; label: string; snapshot: QuoteSnapshot; hashAfter: string; quoteUpdatedAtAfter?: string | null }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await T().insert({
    quote_id: r.quoteId, user_id: u.user.id, action: r.action, label: r.label, snapshot: r.snapshot,
    state_hash_after: r.hashAfter, quote_updated_at_after: r.quoteUpdatedAtAfter ?? new Date().toISOString(),
  });
}
export async function latestUnusedSnapshot(quoteId: string): Promise<SnapshotRow | null> {
  const { data } = await T().select("id, action, label, snapshot, state_hash_after, created_at")
    .eq("quote_id", quoteId).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as SnapshotRow) || null;
}
export async function markSnapshotUsed(id: string) { await T().update({ used_at: new Date().toISOString() }).eq("id", id); }
