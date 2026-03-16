/**
 * SIMPLE PRICING MODEL — Single source of truth
 * 
 * 3 fields on supplier_products:
 *   cost_price      — what we pay (excl VAT), after any trade discount
 *   default_markup_percent — our markup (e.g. 20, 30, 35)
 *   selling_price   — NOT STORED; computed on-the-fly: cost_price × (1 + markup/100), excl VAT
 * 
 * VAT is only added at display/invoice time.
 */

/** South African VAT rate */
export const VAT_RATE = 0.15;

/** Round to 2 decimals */
export const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── THE ONE PRICING FUNCTION ───

export function calcSellingPrice(costPrice: number, markupPercent: number) {
  const sellingExclVat = r2(costPrice * (1 + markupPercent / 100));
  const vatAmount = r2(sellingExclVat * VAT_RATE);
  const sellingInclVat = r2(sellingExclVat + vatAmount);
  return { sellingExclVat, vatAmount, sellingInclVat };
}

// ─── CONVENIENCE WRAPPER (richer return) ───

export interface ProductPricing {
  costPrice: number;
  markupPercent: number;
  sellingPrice: number;
  sellingPriceInclVat: number;
  profit: number;
  vatAmount: number;
}

export function getProductPricing(costPrice: number, markupPercent: number = 35): ProductPricing {
  const { sellingExclVat, vatAmount, sellingInclVat } = calcSellingPrice(costPrice, markupPercent);
  return {
    costPrice,
    markupPercent,
    sellingPrice: sellingExclVat,
    sellingPriceInclVat: sellingInclVat,
    profit: r2(sellingExclVat - costPrice),
    vatAmount,
  };
}

// ─── IMPORT HELPERS ───

/** Strip VAT from an incl-VAT price */
export function stripVat(priceInclVat: number): number {
  return r2(priceInclVat / (1 + VAT_RATE));
}

/** Add VAT to an excl-VAT price */
export function addVat(priceExclVat: number): number {
  return r2(priceExclVat * (1 + VAT_RATE));
}

/** Apply a trade discount to a list price */
export function applyDiscount(listPrice: number, discountPercent: number): number {
  return r2(listPrice * (1 - discountPercent / 100));
}

// ─── BACKWARD COMPAT ALIASES ───

/** @deprecated Use stripVat */
export const exclVatFromIncl = stripVat;

/** @deprecated Use addVat */
export const inclVatFromExcl = addVat;

/** Extract subtotal + VAT from an incl-VAT total */
export function splitVatFromTotal(totalInclVat: number) {
  const subtotal = r2(totalInclVat / (1 + VAT_RATE));
  const vat = r2(totalInclVat - subtotal);
  return { subtotal, vat };
}

// ─── LEGACY calculatePricing — kept for backward compat ───

export interface PricingResult {
  costExclVat: number;
  supplierDiscountPercent: number;
  discountedCost: number;
  markupPercent: number;
  sellingPrice: number;
  sellingPriceInclVat: number;
}

/**
 * Legacy function — discount is now baked into cost_price at import time.
 * The _discountPercent param is ignored (kept for call-site compat).
 */
export function calculatePricing(
  costPrice: number,
  discountPercent: number = 0,
  markupPercent: number = 35
): PricingResult {
  // Discount already baked into cost_price at import — do NOT re-apply
  const discountedCost = costPrice;
  const { sellingExclVat, sellingInclVat } = calcSellingPrice(discountedCost, markupPercent);
  return {
    costExclVat: costPrice,
    supplierDiscountPercent: discountPercent,
    discountedCost: discountedCost,
    markupPercent,
    sellingPrice: sellingExclVat,
    sellingPriceInclVat: sellingInclVat,
  };
}
