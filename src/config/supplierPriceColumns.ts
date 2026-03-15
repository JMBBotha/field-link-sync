/**
 * Supplier-specific base price column configuration.
 *
 * Maps supplier names (as stored in the `suppliers.name` column) to the
 * PDF column header that represents the base cost used for calculations.
 *
 * If a supplier also has `default_price_column` set in the database,
 * that value takes priority over this static map.
 *
 * To add or change a mapping, simply edit the entry below.
 */

export const supplierPriceColumnMap: Record<string, string> = {
  'DAIKIN AIR CONDITIONING': 'WEBSHOP CAMPAIGN PRICE',
  'Midea - Livance': 'NETT PRICE',
  'ONE STOP SHOP': 'NETT PRICE',
  'SAMSUNG AIR CONDITIONING': 'LIST PRICE EXCL VAT',
};

export const DEFAULT_PRICE_COLUMN = 'INSTALLER PRICE';

/**
 * Resolve the base price column name for a given supplier.
 *
 * Priority:
 *   1. `dbOverride` — the value from `suppliers.default_price_column`
 *   2. Static map lookup by supplier name (case-insensitive)
 *   3. Fallback to DEFAULT_PRICE_COLUMN
 */
export function resolveBaseColumn(supplierName: string, dbOverride?: string | null): string {
  if (dbOverride) return dbOverride;

  // Case-insensitive lookup
  const key = Object.keys(supplierPriceColumnMap).find(
    (k) => k.toLowerCase() === supplierName.toLowerCase()
  );
  return key ? supplierPriceColumnMap[key] : DEFAULT_PRICE_COLUMN;
}
