/**
 * PRICING — single source of truth for cost → selling price + VAT math.
 *
 * Data model (confirmed against every real write path — PriceConfigPanel's
 * import wizard, the destructive Suppliers-page import pipeline, and the
 * BrandDiscountsSection admin tool):
 *
 *   cost_price      — what we actually pay, EXCL VAT, AFTER any supplier
 *                      trade discount has already been applied and saved.
 *   cost_excl_vat   — kept in sync with cost_price by every write path above
 *                      (both are always set to the same already-discounted
 *                      value). Treat it purely as a fallback/legacy alias
 *                      for cost_price, never as an undiscounted list price.
 *   selling_price   — NOT STORED; always computed on the fly as
 *                      cost_price × (1 + markup_percent / 100), excl VAT.
 *
 * VAT is only added at display/invoice time via VAT_RATE.
 *
 * IMPORTANT: do not re-apply a supplier trade discount here. A previous
 * version of this file kept a hardcoded SUPPLIER_DISCOUNTS table (e.g.
 * Samsung 20%) and re-applied it on top of cost_price/cost_excl_vat. Because
 * every real import/edit path already writes the fully-discounted cost into
 * both columns, that re-application silently double-discounted every
 * Samsung product by 20% everywhere computePricing/computeProductPricing
 * was used (ProductPalette, QuoteBuilderTab, quoteBasketTotals, MaterialsStep,
 * ACOptionsModal, ConsumablesSuggestionPanel, DragOverlayCard,
 * FallbackProductPanel, PdfPageOverlay, VisualCatalogView). See
 * docs/pricing-and-import-architecture-findings.md for the full writeup.
 *
 * If a supplier's trade discount ever needs to change, apply it once at the
 * source — via the BrandDiscountsSection admin tool (which updates
 * cost_price/cost_excl_vat directly) or the price-list import config — not
 * by re-deriving it here at render time.
 */

/** South African VAT rate */
export const VAT_RATE = 0.15;

/** Round to 2 decimals */
export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Clamp a value between min and max */
const clampRange = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Defend against NaN/negative/absurd inputs reaching a quote or invoice.
 * A garbage cost_price (bad AI parse, empty field, corrupt import row)
 * should never silently produce a R0 or a runaway selling price — it
 * should clamp to a safe, visible value instead.
 */
function sanitizeCostPrice(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 10_000_000); // hard ceiling — no product costs R10m+
}

function sanitizeMarkupPercent(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 35; // fall back to standard markup, not 0
  return clampRange(n, -50, 500); // allow modest loss-leaders, cap runaway markups
}

// ─── THE ONE PRICING FUNCTION (cost is already net of any discount) ───

export function calcSellingPrice(costPrice: number, markupPercent: number) {
  const safeCostPrice = sanitizeCostPrice(costPrice);
  const safeMarkupPercent = sanitizeMarkupPercent(markupPercent);
  const sellingExclVat = r2(safeCostPrice * (1 + safeMarkupPercent / 100));
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

// ─── VAT / DISCOUNT HELPERS ───

/** Strip VAT from an incl-VAT price */
export function stripVat(priceInclVat: number): number {
  return r2(priceInclVat / (1 + VAT_RATE));
}

/** Add VAT to an excl-VAT price */
export function addVat(priceExclVat: number): number {
  return r2(priceExclVat * (1 + VAT_RATE));
}

/** Apply a trade discount to a list price. Used only at write-time (brand
 *  discount admin tool, price-list import) to derive cost_price from a raw
 *  list price — never at render/quote time. */
export function applyDiscount(listPrice: number, discountPercent: number): number {
  return r2(listPrice * (1 - discountPercent / 100));
}

/**
 * Convert a supplier LIST price into our net cost by applying the trade discount.
 * This is the first half of the business identity
 *   list x (1 - discount) x (1 + markup) === list
 * e.g. Samsung: 10 000 x 0.80 x 1.25 = 10 000.
 *
 * Never round here — rounding the intermediate cost is what breaks the identity
 * (e.g. 15 825.23 x 0.8 = 12 660.184 -> 12 660.18 -> x1.25 = 15 825.225 -> 15 825.23).
 * Round only at the final selling price.
 */
export function netCostFromList(listPriceExVat: number, discountPercent: number): number {
  const list = sanitizeCostPrice(listPriceExVat);
  const d = Number(discountPercent);
  if (!Number.isFinite(d) || d <= 0) return list;
  return list * (1 - clampRange(d, 0, 95) / 100);
}

/**
 * Single source of truth for "what does this row actually cost us, ex VAT".
 *
 * - A catalog product's stored cost_price/cost_excl_vat is ALREADY net of the
 *   supplier trade discount (see file header) — trust it verbatim.
 * - A price scraped off a supplier PDF price column is a LIST price — the trade
 *   discount must be applied before markup, otherwise markup stacks on list and
 *   the 0.80 x 1.25 identity is lost.
 */
export function resolveRowCostExVat(
  product: {
    cost_price?: number | null;
    cost_excl_vat?: number | null;
    cost_incl_vat?: number | null;
    supplier_discount_percent?: number | null;
  } | null | undefined,
  detectedListPriceExVat?: number | null,
  supplierDiscountFallbackPercent?: number | null,
): number {
  const storedCost = Number(product?.cost_price ?? 0) || Number(product?.cost_excl_vat ?? 0);
  if (storedCost > 0) return storedCost;

  const discount =
    Number(product?.supplier_discount_percent ?? 0) ||
    Number(supplierDiscountFallbackPercent ?? 0) ||
    0;

  const list = Number(detectedListPriceExVat ?? 0);
  if (list > 0) return netCostFromList(list, discount);

  const inclVat = Number(product?.cost_incl_vat ?? 0);
  return inclVat > 0 ? stripVat(inclVat) : 0;
}


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

// ─── LEGACY calculatePricing — kept for backward compat, not currently called ───

export interface PricingResult {
  costExclVat: number;
  supplierDiscountPercent: number;
  discountedCost: number;
  markupPercent: number;
  sellingPrice: number;
  sellingPriceInclVat: number;
}

/**
 * Legacy function — discount is baked into cost_price at import/edit time.
 * The discountPercent param is ignored (kept for call-site compat).
 */
export function calculatePricing(
  costPrice: number,
  discountPercent: number = 0,
  markupPercent: number = 35
): PricingResult {
  const discountedCost = costPrice;
  const { sellingExclVat, sellingInclVat } = calcSellingPrice(discountedCost, markupPercent);
  return {
    costExclVat: costPrice,
    supplierDiscountPercent: discountPercent,
    discountedCost,
    markupPercent,
    sellingPrice: sellingExclVat,
    sellingPriceInclVat: sellingInclVat,
  };
}

// ─── SUPPLIER CODE + PRODUCT-OBJECT CONVENIENCE (used across builders) ───

export type SupplierCode = "SAMSUNG" | "DAIKIN" | "MIDEA" | "OTHER";

/**
 * Normalize markup input into a percentage value used by pricing math.
 * - 0.35 => 35
 * - 35 => 35
 * - null/undefined/<=0 => 35 (default)
 */
export function normalizeMarkupPercent(markupPercent?: number | null): number {
  if (markupPercent == null || Number.isNaN(markupPercent)) return 35;
  if (markupPercent > 0 && markupPercent <= 1) return r2(markupPercent * 100);
  if (markupPercent <= 0) return 35;
  return markupPercent;
}

/** Resolve a supplier name string to a SupplierCode (display/grouping use only —
 *  no discount is looked up from this code, see file header). */
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
 * cost_price (passed as overrideCostExVat) is trusted as the final,
 * already-discounted cost. No supplier discount is re-applied here — see
 * file header for why. listPriceExVat is only used as a fallback when no
 * cost_price is available at all.
 *
 * @param supplier          - supplier code or name (kept for display/grouping)
 * @param listPriceExVat    - fallback cost if overrideCostExVat is unavailable
 * @param markupPercent     - our markup percentage (e.g. 35 means 35%)
 * @param overrideCostExVat - product.cost_price — the real, already-net cost
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

  const safeMarkupPercent = normalizeMarkupPercent(markupPercent);
  const rawCost = overrideCostExVat != null && overrideCostExVat > 0 ? overrideCostExVat : listPriceExVat;
  const costExVat = r2(sanitizeCostPrice(rawCost));

  const sellExVat = r2(costExVat * (1 + safeMarkupPercent / 100));
  const sellInclVat = r2(sellExVat * (1 + VAT_RATE));

  return { costExVat, sellExVat, sellInclVat, discountPercent: 0, markupPercent: safeMarkupPercent };
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
  const listPrice = product.cost_price || product.cost_excl_vat || 0;
  const markupPct = product.default_markup_percent ?? product.markup_percent ?? 35;
  const supplierCode = resolveSupplierCode(product.supplier_name);
  return computePricing(supplierCode, listPrice, markupPct, product.cost_price || null);
}
