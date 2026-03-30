import type { BundleRange } from "@/types/bundles";

/**
 * Static BTU → bundle-size mapping.
 * Used to match AC units to the correct piping kit bundle.
 * Ranges overlap slightly so that e.g. a 22K and 24K unit both
 * land in the "24K" bucket.
 */
export const CAPACITY_RANGES: BundleRange[] = [
  { label: "9K",  minBtu: 8000,  maxBtu: 10000 },
  { label: "12K", minBtu: 11000, maxBtu: 13000 },
  { label: "18K", minBtu: 17000, maxBtu: 19000 },
  { label: "24K", minBtu: 22000, maxBtu: 26000 },
  { label: "36K", minBtu: 34000, maxBtu: 38000 },
];

/** Parse BTU from a product name like "24K INV MW" → 24000 */
export function parseBtuFromName(name: string): number | null {
  // Match patterns like "24K", "09K", "36K"
  const match = name.match(/\b(\d{1,3})K\b/i);
  if (match) return parseInt(match[1], 10) * 1000;
  // Match full BTU number like "24000"
  const fullMatch = name.match(/\b(\d{4,6})\s*BTU/i);
  if (fullMatch) return parseInt(fullMatch[1], 10);
  return null;
}
