export interface PricingResult {
  costExclVat: number;          // raw from DB
  supplierDiscountPercent: number; // e.g. 20 for 20%
  discountedCost: number;       // costExclVat * (1 - discount/100)
  markupPercent: number;        // user-adjustable, default from product
  sellingPrice: number;         // discountedCost * (1 + markup/100)
  sellingPriceInclVat: number;  // sellingPrice * 1.15
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
  const sellingPriceInclVat = sellingPrice * 1.15;
  return {
    costExclVat,
    supplierDiscountPercent,
    discountedCost,
    markupPercent,
    sellingPrice,
    sellingPriceInclVat,
  };
}
