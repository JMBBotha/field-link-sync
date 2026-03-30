import { CAPACITY_RANGES, parseBtuFromName } from "./bundleData";

/**
 * Find the matching bundle range label for a given BTU capacity.
 * Returns e.g. "09K", "12K", "24K" or null if no range matches.
 */
export function findBundleLabelForCapacity(btu: number): string | null {
  for (const range of CAPACITY_RANGES) {
    if (btu >= range.minBtu && btu <= range.maxBtu) {
      return range.label;
    }
  }
  return null;
}

/**
 * Given a product's BTU (from btu_rating field or parsed from name),
 * find the matching DB bundle from a list of bundles.
 *
 * @param btu         - the AC unit's BTU rating
 * @param dbBundles   - array of installation_bundles (with min_btu, max_btu)
 * @returns the matching bundle or null
 */
export function findMatchingBundle<T extends { min_btu?: number | null; max_btu?: number | null; name?: string }>(
  btu: number,
  dbBundles: T[],
): T | null {
  // First try exact BTU range match from DB
  for (const b of dbBundles) {
    if (b.min_btu != null && b.max_btu != null && btu >= b.min_btu && btu <= b.max_btu) {
      return b;
    }
  }

  // Fallback: match by bundle name containing the capacity label
  const label = findBundleLabelForCapacity(btu);
  if (!label) return null;

  // Pad single-digit labels: "9K" → "09K"
  const paddedLabel = label.length === 2 ? `0${label}` : label;

  for (const b of dbBundles) {
    const name = (b.name || "").toUpperCase();
    if (name.includes(paddedLabel) || name.includes(label)) {
      return b;
    }
  }
  return null;
}

/**
 * Extract BTU from a product object — tries btu_rating field first, then parses from name.
 */
export function extractBtu(product: { btu_rating?: number | null; short_name?: string; description?: string; product_code?: string }): number | null {
  if (product.btu_rating && product.btu_rating > 0) return product.btu_rating;
  const text = [product.short_name, product.description, product.product_code].filter(Boolean).join(" ");
  return parseBtuFromName(text);
}
