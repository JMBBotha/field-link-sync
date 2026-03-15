/**
 * Supplier → price-column header mapping.
 * Used by PdfPriceColumnPill to render a green highlight pill
 * over the correct price column on each supplier's PDF pages.
 *
 * Keys are matched case-insensitively against supplier names.
 * `patterns` are tested against extracted PDF text items.
 */

export interface SupplierPriceColumnConfig {
  /** Display label shown inside the green pill */
  label: string;
  /** Regex patterns to match the column header text in the PDF */
  patterns: RegExp[];
  /** Fallback normalized x position (0–1) if header text isn't found */
  fallbackX?: number;
}

export const SUPPLIER_PRICE_COLUMNS: Record<string, SupplierPriceColumnConfig> = {
  daikin: {
    label: "Webshop Price",
    patterns: [/web\s*shop/i, /webshop\s*(?:campaign\s*)?price/i, /WEBSHOP/i],
    fallbackX: 0.75,
  },
  midea: {
    label: "Net Price",
    patterns: [/net\s*price/i, /\bNET\b/i],
    fallbackX: 0.78,
  },
  alliance: {
    label: "Net Price",
    patterns: [/net\s*price/i, /\bNET\b/i],
    fallbackX: 0.78,
  },
  "one stop": {
    label: "Price",
    patterns: [/price/i, /\bPRICE\b/],
    fallbackX: 0.75,
  },
  "one stop shop": {
    label: "Price",
    patterns: [/price/i, /\bPRICE\b/],
    fallbackX: 0.75,
  },
  samsung: {
    label: "List Price Excl VAT",
    patterns: [/list\s*price\s*excl/i, /excl\.?\s*vat/i, /LIST\s*PRICE/i],
    fallbackX: 0.80,
  },
};

/**
 * Find the matching price column config for a given supplier name.
 * Returns null if no mapping exists.
 */
export function getSupplierPriceColumnConfig(supplierName: string): SupplierPriceColumnConfig | null {
  const lower = (supplierName || "").toLowerCase().trim();
  for (const [key, config] of Object.entries(SUPPLIER_PRICE_COLUMNS)) {
    if (lower.includes(key)) return config;
  }
  return null;
}
