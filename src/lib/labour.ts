/**
 * Hourly labour on quotes — one Labour line per area.
 *
 * Stored as a normal quote_items row:
 *   item_type = "labour", quantity = hours, unit_price = rate, total_price = hours × rate
 *   metadata  = { labour: true, hours, rate, rate_overridden, markup_percent: 0, unit_cost, total_cost, price_locked }
 * Markup is the shared labour rule (categoryMarkupPercent → 0). Cost = sell.
 * A saved line keeps its own rate; the company standard rate only seeds NEW rows.
 */
import { categoryMarkupPercent, classifyQuoteCategory, DEFAULT_CATEGORY_MARKUPS, type CategoryMarkupRates } from "@/lib/pricing";

export const LABOUR_ITEM_TYPE = "labour";
export const LABOUR_STEP = 0.5;

export interface LabourMeta { labour: true; hours: number; rate: number; rate_overridden: boolean }

type ItemLike = { item_type?: string | null; metadata?: unknown; area_id?: string | null; parent_item_id?: string | null };

export function isLabourItem(i: ItemLike | null | undefined): boolean {
  if (!i) return false;
  return i.item_type === LABOUR_ITEM_TYPE && !!(i.metadata as Record<string, unknown> | null)?.labour;
}

export function findAreaLabour<T extends ItemLike>(items: T[], areaId: string | null): T | undefined {
  return items.find((i) => !i.parent_item_id && isLabourItem(i) && (i.area_id ?? null) === areaId);
}

/** Company standard rate, or null when unset / 0 (row then shows "Set rate in Settings"). */
export function standardLabourRate(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hours snapped to 0.5 and never below 0. */
export function snapHours(h: number): number {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / LABOUR_STEP) * LABOUR_STEP;
}
export function stepHours(h: number, dir: 1 | -1): number {
  return snapHours(snapHours(h) + dir * LABOUR_STEP);
}

/** Labour markup via the shared category rule (always 0%). */
export function labourMarkupPercent(rates: CategoryMarkupRates = DEFAULT_CATEGORY_MARKUPS): number {
  return categoryMarkupPercent(classifyQuoteCategory({ item_type: LABOUR_ITEM_TYPE, item_name: "Labour" }), rates);
}

export function labourLineTotal(hours: number, rate: number): number {
  const cost = snapHours(hours) * (Number(rate) || 0);
  return r2(cost * (1 + labourMarkupPercent() / 100));
}

/** Row fields for a labour line. */
export function labourFields(hours: number, rate: number, rateOverridden: boolean) {
  const h = snapHours(hours);
  const total = labourLineTotal(h, rate);
  return {
    item_name: "Labour",
    item_type: LABOUR_ITEM_TYPE,
    quantity: h,
    unit_price: r2(rate),
    total_price: total,
    allows_decimal_qty: true,
    qty_step: LABOUR_STEP,
    min_qty: 0,
    metadata: {
      labour: true, hours: h, rate: r2(rate), rate_overridden: rateOverridden,
      markup_percent: 0, unit_cost: r2(rate), cost_excl: r2(rate), total_cost: total, price_locked: true,
    },
  };
}

/**
 * Next state for a labour line. Existing lines keep their saved rate unless a
 * rate is explicitly given; new lines take the current standard rate.
 * Returns { needsRate: true } when there is no rate to use.
 */
export function planLabour(
  existing: ItemLike | undefined,
  hours: number,
  standardRate: number | null,
  explicitRate?: number | null,
): { needsRate: true } | { needsRate: false; fields: ReturnType<typeof labourFields> } {
  const md = (existing?.metadata || {}) as Partial<LabourMeta>;
  const given = Number(explicitRate);
  if (Number.isFinite(given) && given > 0) {
    return { needsRate: false, fields: labourFields(hours, given, standardRate == null || given !== standardRate || !!md.rate_overridden) };
  }
  if (existing && Number(md.rate) > 0) {
    return { needsRate: false, fields: labourFields(hours, Number(md.rate), !!md.rate_overridden) };
  }
  if (standardRate != null) return { needsRate: false, fields: labourFields(hours, standardRate, false) };
  return { needsRate: true };
}
