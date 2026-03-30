/**
 * CENTRALIZED PRICING HELPER — Single source of truth for supplier discounts + markup.
 *
 * Samsung gives 20% trade discount off list price.
 * Daikin webshop price IS the cost (0% discount).
 * This file ensures the discount is ALWAYS applied regardless of
 * whether it was baked into cost_price at import time.
 */

export type SupplierCode = "SAMSUNG" | "DAIKIN" | "MIDEA" | "OTHER";

/** Trade discount per supplier (fraction, NOT percent) */
export const SUPPLIER_DISCOUNTS: Record<SupplierCode, number> = {
  SAMSUNG: 0.2,
  DAIKIN: 0,
  MIDEA: 0,
  OTHER: 0,
};

export const VAT_RATE = 0.15;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Resolve a supplier name string to a SupplierCode */
export function resolveSupplierCode(supplierName: string | undefined | null): SupplierCode {
  if (!supplierName) return "OTHER";
  const upper = supplierName.toUpperCase();
  if (upper.includes("SAMSUNG")) return "SAMSUNG";
  if (upper.includes("DAIKIN")) return "DAIKIN";
  if (upper.includes("MIDEA")) return "MIDEA";
  return "OTHER";
}

export interface ComputedPricing {
  costExVat: number;
  sellExVat: number;
  sellInclVat: number;
  discountPercent: number;
  markupPercent: number;
}

/**
 * Compute cost → sell → sell-incl-VAT for any product.
 *
 * @param supplier       - supplier code or name
 * @param listPriceExVat - the price from the supplier price list (BEFORE trade discount)
 * @param markupPercent  - our markup percentage (e.g. 35 means 35%)
 * @param overrideCostExVat - if non-null, use this as costExVat instead of computing from listPrice
 */
export function computePricing(
  supplier: SupplierCode | string,
  listPriceExVat: number,
  markupPercent: number,
  overrideCostExVat?: number | null,
): ComputedPricing {
  const code = typeof supplier === "string" && !["SAMSUNG", "DAIKIN", "MIDEA", "OTHER"].includes(supplier)
    ? resolveSupplierCode(supplier)
    : (supplier as SupplierCode);

  const discount = SUPPLIER_DISCOUNTS[code] ?? 0;

  // If an override cost is provided AND it's already discounted (lower than list), use it.
  // Otherwise compute from list price with supplier discount.
  let costExVat: number;
  if (overrideCostExVat != null && overrideCostExVat > 0 && overrideCostExVat < listPriceExVat * 0.99) {
    // cost_price was already discounted at import — use it
    costExVat = r2(overrideCostExVat);
  } else {
    costExVat = r2(listPriceExVat * (1 - discount));
  }

  const sellExVat = r2(costExVat * (1 + markupPercent / 100));
  const sellInclVat = r2(sellExVat * (1 + VAT_RATE));

  return { costExVat, sellExVat, sellInclVat, discountPercent: discount * 100, markupPercent };
}

/**
 * Convenience: compute pricing from a product-shaped object (PaletteProduct or similar).
 * Use this anywhere you'd previously write `product.selling_price || product.cost_incl_vat || 0`.
 */
export function computeProductPricing(product: {
  cost_excl_vat?: number;
  cost_price?: number;
  cost_incl_vat?: number;
  selling_price?: number;
  default_markup_percent?: number;
  markup_percent?: number | null;
  supplier_name?: string;
  supplier_discount_percent?: number | null;
}): ComputedPricing {
  const listPrice = product.cost_excl_vat || 0;
  const markupPct = product.default_markup_percent ?? product.markup_percent ?? 35;
  const supplierCode = resolveSupplierCode(product.supplier_name);
  return computePricing(supplierCode, listPrice, markupPct, product.cost_price || null);
}
