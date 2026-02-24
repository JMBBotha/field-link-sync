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
 */
export function computeItemsSubtotal(items: QuoteItem[]): number {
  return items
    .filter((i) => !i.parent_item_id)
    .reduce((sum, item) => {
      const price = item.total_price ?? item.unit_price * item.quantity;
      return sum + price;
    }, 0);
}

/**
 * Helper to create the default "General" area name
 */
export function getDefaultAreaName(): string {
  return DEFAULT_AREA_NAME;
}
