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
    .filter((i) => !i.parent_item_id && i.source !== "legacy_placeholder")
    .reduce((sum, item) => {
      const price = item.total_price ?? item.unit_price * item.quantity;
      return sum + price;
    }, 0);
}

/** South African VAT rate used for all quote totals. */
export const QUOTE_VAT_RATE = 0.15;

export interface QuoteTotals {
  itemCount: number;
  zoneCount: number;
  subtotal: number;
  vatAmount: number;
  total: number;
  avgMarkup: number;
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
 *  - avgMarkup = mean of metadata.markup_percent across items with a positive
 *    markup value; 0 when none available.
 */
export function computeQuoteTotals(
  items: QuoteItem[],
  areas: QuoteArea[],
  vatRate: number = QUOTE_VAT_RATE
): QuoteTotals {
  const topLevel = items.filter(
    (i) => !i.parent_item_id && i.source !== "legacy_placeholder"
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

  const markups = topLevel
    .map((i) => Number((i.metadata as Record<string, unknown>)?.markup_percent))
    .filter((m) => Number.isFinite(m) && m > 0);
  const avgMarkup =
    markups.length > 0 ? markups.reduce((s, m) => s + m, 0) / markups.length : 0;

  return {
    itemCount: topLevel.length,
    zoneCount: usedAreas.size,
    subtotal,
    vatAmount,
    total,
    avgMarkup,
  };
}

/**
 * Helper to create the default "General" area name
 */
export function getDefaultAreaName(): string {
  return DEFAULT_AREA_NAME;
}
