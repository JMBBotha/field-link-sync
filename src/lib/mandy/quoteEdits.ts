/**
 * Pure helpers for Mandy's quote edit toolkit. No I/O, no pricing formulas of
 * their own: floors come from classifyQuoteCategory + categoryMarkupPercent,
 * kit lengths from kitLengthPatch, labour from labourFields. Handlers in
 * MandyQuoteActions call these and then write through QuoteContext.
 */
import { classifyQuoteCategory, categoryMarkupPercent, type CategoryMarkupRates } from "@/lib/pricing";
import { kitLengthPatch } from "@/lib/mandy/quoteOps";
import { isLabourItem, labourFields } from "@/lib/labour";

export interface EditItem {
  id: string;
  area_id: string | null;
  parent_item_id?: string | null;
  item_name: string;
  item_number?: string | null;
  item_type?: string | null;
  is_bundle?: boolean | null;
  quantity?: number | null;
  length?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  sort_order?: number | null;
  product_id?: string | null;
  notes?: string | null;
  metadata?: any;
}
export interface EditArea { id: string; name: string }

const lc = (s?: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
const STOP = new Set(["the", "a", "an", "in", "on", "of", "line", "item", "to", "from", "my", "that", "this"]);
const words = (s: string) => lc(s).split(" ").filter((w) => w && !STOP.has(w));

export const isKit = (i: EditItem) => !!i.is_bundle || /kit/i.test(i.item_type || "") || !!i.metadata?.kit;
export const isLabour = (i: EditItem) => isLabourItem(i as any);

/** Spoken aliases for line kinds so "the labour" / "the kit" / "the unit" resolve. */
function aliasBlob(i: EditItem): string {
  const extra = [isLabour(i) ? "labour labor hours" : "", isKit(i) ? "kit piping pipes copper" : "", !isKit(i) && !isLabour(i) ? "unit aircon ac" : ""];
  const k = String(i.item_name || "").match(/(\d{1,2})\s*k\b/i)?.[1];
  return lc([i.item_name, i.item_number, ...extra, k ? `${k}k ${k}000` : ""].join(" "));
}

export interface ItemMatch { hits: EditItem[]; area: EditArea | null }

/**
 * Fuzzy line matcher: "the labour", "the Samsung", "the kit in bedroom 1".
 * An "in/from <area>" suffix narrows to that area. Returns every best-scoring
 * hit — more than one means the caller must show chips.
 */
export function matchQuoteItem(items: EditItem[], areas: EditArea[], ref: string): ItemMatch {
  let q = String(ref || "");
  let area: EditArea | null = null;
  const m = q.match(/\b(?:in|from|on)\s+(?:the\s+)?(.+)$/i);
  if (m) {
    const an = lc(m[1]);
    area = areas.find((a) => lc(a.name) === an) || areas.find((a) => lc(a.name).includes(an) || an.includes(lc(a.name))) || null;
    if (area) q = q.slice(0, m.index).trim();
  }
  const top = items.filter((i) => !i.parent_item_id && (!area || i.area_id === area.id));
  const exact = top.filter((i) => lc(i.item_number) === lc(q) || lc(i.item_name) === lc(q) || i.id === q);
  if (exact.length) return { hits: exact, area };
  const w = words(q);
  if (!w.length) return { hits: area ? top : [], area };
  let best = 0;
  const scored = top.map((i) => {
    const blob = aliasBlob(i);
    const s = w.reduce((n, x) => n + (blob.includes(x) ? 1 : 0), 0);
    if (s > best) best = s;
    return { i, s };
  });
  return { hits: best > 0 ? scored.filter((x) => x.s === best).map((x) => x.i) : [], area };
}

/** The kit that belongs to a unit: bundle children, else the adjacent kit row in the same area with the same size. */
export function findUnitKits(items: EditItem[], unit: EditItem): EditItem[] {
  if (isKit(unit) || isLabour(unit)) return [];
  const children = items.filter((i) => i.parent_item_id === unit.id);
  if (children.length) return children;
  const k = String(unit.item_name || "").match(/(\d{1,2})\s*k\b/i)?.[1];
  const sameArea = items.filter((i) => i.id !== unit.id && !i.parent_item_id && i.area_id === unit.area_id && isKit(i));
  const bySize = k ? sameArea.filter((i) => new RegExp(`\\b0?${k}K\\b`, "i").test(i.item_name)) : [];
  const pool = bySize.length ? bySize : sameArea;
  const adjacent = pool.filter((i) => Number(i.sort_order) === Number(unit.sort_order) + 1);
  return (adjacent.length ? adjacent : pool).slice(0, 1);
}

/** Snap qty to the product's qty_step, never below min_qty. */
export function snapQty(qty: number, p?: { qty_step?: number | null; min_qty?: number | null; allows_decimal_qty?: boolean | null } | null): number {
  const step = Number(p?.qty_step) > 0 ? Number(p!.qty_step) : 1;
  const min = Number(p?.min_qty) > 0 ? Number(p!.min_qty) : step;
  let v = Math.round(Number(qty) / step) * step;
  if (!p?.allows_decimal_qty && step >= 1) v = Math.round(v);
  return Number(Math.max(min, v).toFixed(4));
}

/** Quantity patch the same way the builder does: kits/length items change length, others change qty. */
export function qtyPatch(item: EditItem, qty: number, product?: Parameters<typeof snapQty>[1]) {
  if (isLabour(item)) {
    const f = labourFields(qty, Number(item.metadata?.rate ?? item.unit_price) || 0, !!item.metadata?.rate_overridden);
    const { item_name: _n, allows_decimal_qty: _d, qty_step: _s, min_qty: _m, ...keep } = f;
    return { kind: "hours" as const, value: f.quantity, patch: { ...keep, metadata: { ...(item.metadata || {}), ...f.metadata } } as Record<string, any> };
  }
  if (isKit(item) || item.length != null) return { kind: "length" as const, value: kitLengthPatch(item, qty).length, patch: kitLengthPatch(item, qty) as Record<string, any> };
  const q = snapQty(qty, product);
  const unitCost = Number(item.metadata?.unit_cost);
  const up = Number(item.unit_price) || 0;
  return {
    kind: "qty" as const,
    value: q,
    patch: <Record<string, any>>{
      quantity: q,
      total_price: Number((q * up).toFixed(2)),
      ...(Number.isFinite(unitCost) && item.metadata ? { metadata: { ...item.metadata, total_cost: Number((q * unitCost).toFixed(2)) } } : {}),
    },
  };
}

/** Category markup floor for a line: stored unit cost × (1 + category markup). null = cost unknown. */
export function priceFloor(item: EditItem, rates: CategoryMarkupRates): number | null {
  const cost = Number(item.metadata?.unit_cost ?? item.metadata?.cost_excl);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const pct = categoryMarkupPercent(classifyQuoteCategory(item as any), rates);
  return Number((cost * (1 + pct / 100)).toFixed(2));
}

export type PriceDecision =
  | { kind: "refuse"; floor: number | null; reason: string }
  | { kind: "confirm" | "apply"; patch: Record<string, any>; list: number; floor: number };

/** set_line_price: never below the floor; below list needs Confirm; cost never changes. */
export function linePriceDecision(item: EditItem, price: number, rates: CategoryMarkupRates): PriceDecision {
  const p = Number(Number(price).toFixed(2));
  if (!(p > 0)) return { kind: "refuse", floor: null, reason: "Give a price above zero." };
  const floor = priceFloor(item, rates);
  if (floor == null) return { kind: "refuse", floor: null, reason: `${item.item_name} has no cost on file, so I can't check the price floor.` };
  if (p < floor) return { kind: "refuse", floor, reason: `That's below the floor for ${item.item_name}.` };
  const md = item.metadata || {};
  const list = Number(md.original_sell ?? item.unit_price) || 0;
  const cost = Number(md.unit_cost ?? md.cost_excl);
  const qty = isKit(item) ? 1 : Number(item.quantity) || 1;
  const patch = {
    unit_price: p,
    total_price: Number((p * qty).toFixed(2)),
    metadata: {
      ...md,
      price_overridden: true, manual_price: true, price_locked: true,
      override_price: p, original_sell: Number(md.original_sell ?? item.unit_price) || p,
      markup_percent: Number((((p - cost) / cost) * 100).toFixed(2)),
    },
  };
  return { kind: p < list ? "confirm" : "apply", patch, list, floor };
}

/** Rows to insert for duplicate_area: stored prices + metadata untouched; children keep their parent. */
export function duplicateAreaRows(items: EditItem[], fromAreaId: string) {
  const src = items.filter((i) => i.area_id === fromAreaId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return src.map((i) => {
    const { id: _id, quote_id: _q, created_at: _c, updated_at: _u, area_id: _a, ...rest } = i as any;
    return { srcId: i.id, parentSrcId: i.parent_item_id || null, row: { ...rest, metadata: i.metadata ? JSON.parse(JSON.stringify(i.metadata)) : {} } };
  });
}

/* ───────── multi-step plans ───────── */

export interface PlanStep { action: string; args: Record<string, unknown> }

/** Accepts run_plan args ({steps:[…]}) or a raw array; drops malformed steps. */
export function parsePlan(raw: unknown): PlanStep[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.steps) ? (raw as any).steps : [];
  return arr
    .map((s: any) => {
      let args = s?.args ?? {};
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
      return { action: String(s?.action || "").trim(), args: args && typeof args === "object" ? args : {} };
    })
    .filter((s: PlanStep) => !!s.action && s.action !== "run_plan");
}

export interface PlanRunReport { ran: number; total: number; failedAt: number | null; messages: string[] }

/** Run steps in order; stop at the first failure and report which steps ran. */
export async function runPlanSteps(steps: PlanStep[], exec: (s: PlanStep) => Promise<{ ok: boolean; message: string; choices?: unknown[]; confirm?: unknown }>): Promise<PlanRunReport> {
  const messages: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    let r: { ok: boolean; message: string; choices?: unknown[]; confirm?: unknown };
    try { r = await exec(steps[i]); } catch (e) { r = { ok: false, message: e instanceof Error ? e.message : String(e) }; }
    // A step that needs a pick or a second confirm can't complete inside a plan.
    const stuck = !r.ok || (r.choices && r.choices.length) || r.confirm;
    messages.push(`${i + 1}. ${r.message}`);
    if (stuck) return { ran: i, total: steps.length, failedAt: i, messages };
  }
  return { ran: steps.length, total: steps.length, failedAt: null, messages };
}

export function planReportText(r: PlanRunReport): string {
  if (r.failedAt == null) return `Done — all ${r.total} steps ran. ${r.messages.join(" ")}`;
  return `Stopped at step ${r.failedAt + 1} of ${r.total}; ${r.ran} step${r.ran === 1 ? "" : "s"} ran. ${r.messages.join(" ")}`;
}
