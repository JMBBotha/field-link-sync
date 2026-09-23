/**
 * Pure utility functions for transforming quote data between builder modes.
 * No side-effects — all DB operations happen in QuoteContext.
 */

import type { QuoteArea, QuoteItem } from "@/types/quote";

const DEFAULT_AREA_NAME = "General";

/**
 * Checks if a default "General" area is needed and returns it.
 * Does NOT insert into DB — the caller (context) handles that.
 */
export function needsDefaultArea(items: QuoteItem[], areas: QuoteArea[]): boolean {
  return items.length > 0 && areas.length === 0;
}

/**
 * Groups items by area_id for the Normal (basket/zone) builder.
 * Items with null area_id are grouped under a synthetic "unassigned" key.
 */
export function groupItemsByArea(
  items: QuoteItem[],
  areas: QuoteArea[]
): Record<string, QuoteItem[]> {
  const groups: Record<string, QuoteItem[]> = {};
  // Pre-populate with empty arrays for every area
  for (const area of areas) {
    groups[area.id] = [];
  }
  for (const item of items) {
    // Only include top-level items (bundle children are nested)
    if (item.parent_item_id) continue;
    const key = item.area_id || "unassigned";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  // Sort each group by sort_order
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.sort_order - b.sort_order);
  }
  return groups;
}

/**
 * Returns all items with an attached area name for the Visual builder.
 */
export function flattenForVisual(
  items: QuoteItem[],
  areas: QuoteArea[]
): (QuoteItem & { areaName: string })[] {
  const areaMap = new Map(areas.map((a) => [a.id, a.name]));
  return items
    .filter((i) => !i.parent_item_id) // top-level only
    .map((item) => ({
      ...item,
      areaName: item.area_id ? areaMap.get(item.area_id) || DEFAULT_AREA_NAME : DEFAULT_AREA_NAME,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Gets bundle children for a given parent item.
 */
export function getBundleChildren(items: QuoteItem[], parentId: string): QuoteItem[] {
  return items
    .filter((i) => i.parent_item_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Computes subtotal for a list of items (top-level only).
 * Excludes bundle children and `legacy_placeholder` rows.
 */
export function computeItemsSubtotal(items: QuoteItem[]): number {
  return items
    .filter((i) => !i.parent_item_id && isRealQuoteItem(i))
    .reduce((sum, item) => {
      const price = item.total_price ?? item.unit_price * item.quantity;
      return sum + price;
    }, 0);
}

/** South African VAT rate used for all quote totals. */
import { classifyQuoteCategory } from "@/lib/pricing";

export const QUOTE_VAT_RATE = 0.15;

export interface QuoteTotals {
  itemCount: number;
  zoneCount: number;
  subtotal: number;
  vatAmount: number;
  total: number;
  /** Blended project markup: (Σ sell − Σ cost) / Σ cost, over lines with a known cost. */
  avgMarkup: number;
  /** Σ cost ex VAT of lines with a known cost */
  totalCost: number;
  /** Σ sell − Σ cost (ex VAT) over lines with a known cost */
  profit: number;
  /** Overall margin: (Σ sell − Σ cost) / Σ sell × 100. Never equal to markup. */
  marginPercent: number;
  /** Blended markup split: AC units vs everything else (kits, materials, consumables) */
  unitsMarkup: number | null;
  materialsMarkup: number | null;
  /** Labour: flat rate, no markup. Sell total of labour lines. */
  labourTotal: number;
  /** Discount taken off the ex-VAT subtotal (profit maths use subtotal − discount). */
  discountAmount: number;
  /** Lines left out of the markup maths because no cost is known. */
  noCostCount: number;
  /** Units + materials markup on cost, EXCLUDING labour (after discount). */
  unitsMaterialsMarkup: number | null;
}

/**
 * Spread a quote discount over units + materials lines in proportion to their
 * pre-discount sell. Labour never receives any discount. Returns id → rand share.
 */
export function allocateQuoteDiscount(
  items: QuoteItem[],
  amount: number,
  isLabour: (i: QuoteItem) => boolean = (i) => classifyQuoteCategory(i) === "labour",
): Map<string, number> {
  const out = new Map<string, number>();
  if (!(amount > 0)) return out;
  const eligible = items.filter((i) => !isLabour(i));
  const base = eligible.reduce((s, i) => s + (i.total_price ?? i.unit_price * i.quantity), 0);
  if (base <= 0) return out;
  for (const i of eligible) out.set(i.id, (amount * (i.total_price ?? i.unit_price * i.quantity)) / base);
  return out;
}

export interface QuoteDiscount { type?: string | null; value?: number | null }

export function quoteDiscountAmount(subtotal: number, d?: QuoteDiscount | null): number {
  if (!d) return 0;
  const v = Number(d.value || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const t = (d.type || "").toLowerCase();
  const amt = t === "percentage" || t === "percent" ? (subtotal * v) / 100 : t === "fixed" || t === "amount" ? v : 0;
  return Math.min(Math.max(0, amt), subtotal);
}

/**
 * A real quote item must be a non-placeholder row with meaningful quantity or
 * price data. This keeps zero-value scaffolding rows out of all visible totals.
 */
export function isRealQuoteItem(item: QuoteItem): boolean {
  return (
    item.source !== "legacy_placeholder" &&
    ((item.quantity ?? 0) > 0 || (item.unit_price ?? 0) > 0 || (item.total_price ?? 0) > 0)
  );
}

/**
 * Single source of truth for header/sidebar quote totals.
 * Always derives from the shared quote_items + quote_areas arrays so every
 * consumer (builder header, sidebar summary, PDF) stays consistent.
 *
 * Rules:
 *  - Bundle children (parent_item_id != null) are excluded (rolled into parent).
 *  - `legacy_placeholder` items are excluded from counts/subtotal/VAT.
 *  - Zone count = number of areas that contain at least one real item,
 *    plus a synthetic "unassigned" bucket when top-level items lack an area.
 *  - avgMarkup = BLENDED project markup (Σ sell − Σ cost) / Σ cost — weighted
 *    by rand value, not a simple mean of line percentages. e.g. R20 000 unit at
 *    25% + R2 000 of kit at 100% ≈ 30%, not (25+100)/2 = 62.5%.
 */
export function computeQuoteTotals(
  items: QuoteItem[],
  areas: QuoteArea[],
  vatRate: number = QUOTE_VAT_RATE,
  discount?: QuoteDiscount | null
): QuoteTotals {
  const topLevel = items.filter(
    (i) => !i.parent_item_id && isRealQuoteItem(i)
  );

  const subtotal = topLevel.reduce((sum, item) => {
    const price = item.total_price ?? item.unit_price * item.quantity;
    return sum + price;
  }, 0);

  const vatAmount = subtotal * vatRate;
  const total = subtotal + vatAmount;

  const areaIds = new Set(areas.map((a) => a.id));
  const usedAreas = new Set<string>();
  for (const item of topLevel) {
    if (item.area_id && areaIds.has(item.area_id)) usedAreas.add(item.area_id);
    else usedAreas.add("__unassigned__");
  }

  // Cost of each line: metadata.total_cost, else unit_cost × qty, else back
  // out from sell and the stated markup. Lines with no cost info are left out
  // of the markup maths (rather than pretending they're 0% or 100%).
  const isLabour = (i: QuoteItem) => classifyQuoteCategory(i) === "labour";
  const lineCost = (i: QuoteItem): number | null => {
    const md = (i.metadata || {}) as Record<string, unknown>;
    const sell = i.total_price ?? i.unit_price * i.quantity;
    // Labour: flat rate, 0% markup → cost = sell. Included in overall markup on purpose.
    if (isLabour(i)) return sell;
    const tc = Number(md.total_cost);
    if (Number.isFinite(tc) && tc > 0) return tc;
    const uc = Number(md.unit_cost ?? md.cost_excl);
    if (Number.isFinite(uc) && uc > 0) return uc * (i.quantity || 1);
    const m = Number(md.markup_percent);
    if (Number.isFinite(m) && m > 0 && sell > 0) return sell / (1 + m / 100);
    return null;
  };
  // Classify by CATEGORY (item_type = product_category), never free-text name,
  // so "AC copper pipe" isn't counted as a unit. Mirrors the builder's isAC.
  const isUnit = (i: QuoteItem) => classifyQuoteCategory(i) === "units";
  const blend = (list: QuoteItem[]) => {
    let c = 0, sl = 0;
    for (const i of list) {
      const cost = lineCost(i);
      if (cost == null) continue;
      c += cost;
      sl += i.total_price ?? i.unit_price * i.quantity;
    }
    return { cost: c, sell: sl, markup: c > 0 ? ((sl - c) / c) * 100 : null };
  };
  const all = blend(topLevel);
  const units = blend(topLevel.filter(isUnit));
  const mats = blend(topLevel.filter((i) => !isUnit(i) && !isLabour(i)));
  const labourTotal = topLevel.filter(isLabour).reduce((s2, i) => s2 + (i.total_price ?? i.unit_price * i.quantity), 0);
  // No-cost lines are NEVER treated as R0 cost: they're left out of the markup
  // maths (counted in noCostCount) but their sell still counts in subtotal/total.
  const noCostCount = topLevel.filter((i) => lineCost(i) == null).length;
  // Discount: before VAT, never allocated to labour — spread over units +
  // materials in proportion to their pre-discount sell.
  const discountAmount = quoteDiscountAmount(subtotal, discount);
  const share = allocateQuoteDiscount(topLevel, discountAmount, isLabour);
  const costedShare = topLevel.reduce((s2, i) => s2 + (lineCost(i) != null ? share.get(i.id) || 0 : 0), 0);
  const netSell = all.sell - costedShare;
  const profit = netSell - all.cost;
  const avgMarkup = all.cost > 0 ? (profit / all.cost) * 100 : 0;
  const marginPercent = netSell > 0 && all.cost > 0 ? (profit / netSell) * 100 : 0;
  // Second figure: units + materials only (labour excluded), after discount.
  const um = blend(topLevel.filter((i) => !isLabour(i)));
  const umProfit = um.sell - costedShare - um.cost;
  const unitsMaterialsMarkup = um.cost > 0 ? (umProfit / um.cost) * 100 : null;

  return {
    itemCount: topLevel.length,
    zoneCount: usedAreas.size,
    subtotal,
    vatAmount,
    total,
    avgMarkup,
    totalCost: all.cost,
    profit,
    marginPercent,
    labourTotal,
    discountAmount,
    noCostCount,
    unitsMaterialsMarkup,
    unitsMarkup: units.cost > 0 ? units.markup : null,
    materialsMarkup: mats.cost > 0 ? mats.markup : null,
  };
}

/**
 * Helper to create the default "General" area name
 */
export function getDefaultAreaName(): string {
  return DEFAULT_AREA_NAME;
}

/**
 * Colour band for the OVERALL quote markup (labour included, after discount,
 * before VAT): Green ≥ 35% · Amber 25–34.9% · Red < 25%.
 */
export type MarkupHealth = "Good" | "Fair" | "Low";
export function blendedMarkupHealth(markup: number): MarkupHealth {
  if (!Number.isFinite(markup) || markup < 25) return "Low";
  if (markup < 35) return "Fair";
  return "Good";
}
export const BLENDED_MARKUP_BAR_MAX = 100;
