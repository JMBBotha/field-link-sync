/** South African VAT rate — single source of truth */
export const VAT_RATE = 0.15;

export interface PricingResult {
  costExclVat: number;          // raw from DB
  supplierDiscountPercent: number; // e.g. 20 for 20%
  discountedCost: number;       // costExclVat * (1 - discount/100)
  markupPercent: number;        // user-adjustable, default from product
  sellingPrice: number;         // discountedCost * (1 + markup/100)
  sellingPriceInclVat: number;  // sellingPrice * (1 + VAT_RATE)
}

export function calculatePricing(
  costExclVat: number,
  supplierDiscountPercent: number = 0,
  markupPercent: number = 20
): PricingResult {
  if (!supplierDiscountPercent) {
    console.warn('[pricing] supplierDiscountPercent is 0 or undefined — no discount applied');
  }
  if (supplierDiscountPercent > 50) {
    console.warn(`[pricing] supplierDiscountPercent=${supplierDiscountPercent}% exceeds 50% — sanity check`);
  }
  const discountedCost = costExclVat * (1 - supplierDiscountPercent / 100);
  const sellingPrice = discountedCost * (1 + markupPercent / 100);
  const sellingPriceInclVat = sellingPrice * (1 + VAT_RATE);
  return {
    costExclVat,
    supplierDiscountPercent,
    discountedCost,
    markupPercent,
    sellingPrice,
    sellingPriceInclVat,
  };
}

/** Helper: extract subtotal + VAT from an incl-VAT grand total */
export function splitVatFromTotal(totalInclVat: number) {
  const subtotal = totalInclVat / (1 + VAT_RATE);
  const vat = totalInclVat - subtotal;
  return { subtotal, vat };
}

/** Helper: get cost_excl_vat from cost_incl_vat */
export function exclVatFromIncl(costInclVat: number) {
  return costInclVat / (1 + VAT_RATE);
}

/** Helper: get cost_incl_vat from cost_excl_vat */
export function inclVatFromExcl(costExclVat: number) {
  return costExclVat * (1 + VAT_RATE);
}
