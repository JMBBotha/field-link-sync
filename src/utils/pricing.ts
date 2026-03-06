/**
 * SIMPLE PRICING MODEL — Single source of truth
 * 
 * 3 fields on supplier_products:
 *   cost_price      — what we pay (excl VAT), after any trade discount
 *   default_markup_percent — our markup (e.g. 20, 30)
 *   selling_price   — DB GENERATED: cost_price × (1 + markup/100), excl VAT
 * 
 * VAT is only added at display/invoice time.
 */

/** South African VAT rate */
export const VAT_RATE = 0.15;

/** Round to 2 decimals */
const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── CORE PRICING FUNCTION ───

export interface ProductPricing {
  costPrice: number;            // excl VAT — what we pay
  markupPercent: number;        // our markup %
  sellingPrice: number;         // excl VAT — what we charge
  sellingPriceInclVat: number;  // incl VAT — customer-facing
  profit: number;               // sellingPrice - costPrice
  vatAmount: number;            // VAT on selling price
}

/**
 * THE one pricing function. Used everywhere.
 * @param costPrice - excl VAT cost (after any trade discount)
 * @param markupPercent - markup percentage (default 20)
 */
export function getProductPricing(costPrice: number, markupPercent: number = 20): ProductPricing {
  const sellingPrice = r2(costPrice * (1 + markupPercent / 100));
  const vatAmount = r2(sellingPrice * VAT_RATE);
  const sellingPriceInclVat = r2(sellingPrice + vatAmount);
  const profit = r2(sellingPrice - costPrice);
  return { costPrice, markupPercent, sellingPrice, sellingPriceInclVat, profit, vatAmount };
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
  _discountPercent: number = 0,
  markupPercent: number = 20
): PricingResult {
  const p = getProductPricing(costPrice, markupPercent);
  return {
    costExclVat: costPrice,
    supplierDiscountPercent: 0,
    discountedCost: costPrice,    // cost_price IS the discounted cost now
    markupPercent,
    sellingPrice: p.sellingPrice,
    sellingPriceInclVat: p.sellingPriceInclVat,
  };
}
