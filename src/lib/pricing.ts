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
 * IMPORTANT: every supplier has its own discount structure, and it is already
 * baked into cost_price at import/admin time. Do not re-apply any trade
 * discount here, and never hard-code a supplier percentage. A previous version
 * kept a hardcoded SUPPLIER_DISCOUNTS table and silently double-discounted
 * affected brands everywhere computePricing/computeProductPricing was used
 * (ProductPalette, QuoteBuilderTab, quoteBasketTotals, MaterialsStep,
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
 * Convert a supplier LIST price into our net cost using THAT supplier's own
 * stored trade discount. Write/import-time only — never at quote time, and
 * never with a hard-coded or supplier-specific percentage.
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
 *   row's own supplier discount must be applied before markup, otherwise markup
 *   would stack on the list price.
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


/** COST per metre for a metre-sold catalog product. price_per_metre is
 *  stored as COST/m; fall back to pack cost / coil length. Never sell. */
export function costPerMetreOf(product: {
  price_per_metre?: number | null;
  cost_price?: number | null;
  cost_excl_vat?: number | null;
  unit_length?: number | null;
} | null | undefined): number {
  const ppm = Number(product?.price_per_metre ?? 0);
  if (ppm > 0) return ppm;
  const pack = Number(product?.cost_price ?? 0) || Number(product?.cost_excl_vat ?? 0);
  return pack / (Number(product?.unit_length ?? 0) || 1);
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

/**
 * Resolve markup % for a catalog product. THE resolver — use this everywhere a
 * product object (not a known non-zero number) is the source of the markup.
 *
 * Matches the spot-check SQL:
 *   COALESCE(NULLIF(default_markup_percent,0), NULLIF(markup_percent,0), 35)
 *
 * Why this exists: `a ?? b ?? 35` does NOT skip a stored 0, and a lone 0 then
 * falls through normalizeMarkupPercent() to 35 — which showed cost + 35%
 * instead of that product's own catalog default markup.
 */
export function resolveProductMarkupPercent(product: {
  default_markup_percent?: number | null;
  markup_percent?: number | null;
  product_category?: string | null;
  category?: string | null;
  short_name?: string | null;
  product_code?: string | null;
  supplier_type?: string | null;
}): number {
  // Inside an open quote the CATEGORY rate wins over the catalogue markup.
  if (activeRates && product) return categoryMarkupPercent(classifyQuoteCategory(product), activeRates);
  return resolveCatalogMarkupPercent(product);
}

/** Catalogue-only markup (ignores quote category rates). */
export function resolveCatalogMarkupPercent(product: {
  default_markup_percent?: number | null;
  markup_percent?: number | null;
}): number {
  const d = Number(product?.default_markup_percent);
  if (Number.isFinite(d) && d !== 0) return normalizeMarkupPercent(d);
  const m = Number(product?.markup_percent);
  if (Number.isFinite(m) && m !== 0) return normalizeMarkupPercent(m);
  return 35;
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
 * If a product carries a price lock (re-hydrated saved quote line), return the
 * locked pricing. Returns null when the product is not locked.
 * See PaletteProduct.locked_sell_ex_vat.
 */
export function lockedPricing(product: {
  locked_sell_ex_vat?: number | null;
  locked_cost_ex_vat?: number | null;
} | null | undefined): ComputedPricing | null {
  const locked = Number(product?.locked_sell_ex_vat);
  if (product?.locked_sell_ex_vat == null || !Number.isFinite(locked) || locked < 0) return null;
  const sellExVat = r2(locked);
  const rawCost = Number(product?.locked_cost_ex_vat);
  const costExVat = Number.isFinite(rawCost) && rawCost > 0 ? r2(rawCost) : sellExVat;
  const markupPercent = costExVat > 0 ? r2(((sellExVat - costExVat) / costExVat) * 100) : 0;
  return {
    costExVat,
    sellExVat,
    sellInclVat: r2(sellExVat * (1 + VAT_RATE)),
    discountPercent: 0,
    markupPercent,
  };
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
  locked_sell_ex_vat?: number | null;
  locked_cost_ex_vat?: number | null;
}): ComputedPricing {
  const locked = lockedPricing(product);
  if (locked) return locked;
  const listPrice = product.cost_price || product.cost_excl_vat || 0;
  const markupPct = resolveProductMarkupPercent(product);
  const supplierCode = resolveSupplierCode(product.supplier_name);
  return computePricing(supplierCode, listPrice, markupPct, product.cost_price || null);
}

// ─── CATEGORY MARKUP (Johan lock 2026-09-23) ───
//
// Every quote line is one of three categories, each marked up on ITS OWN cost:
//   units     (AC units / equipment)          → quote Units %      (company default 25)
//   materials (kits, piping, consumables, …)  → quote Materials %  (company default 100)
//   labour    (installation / service labour) → NO markup, flat rate as entered
// Precedence inside a quote: quote override > company category default.
// A product's own catalogue markup is only used OUTSIDE a quote (catalog
// browsing) or when a line can't be classified; 35 is the very last resort.
// The overall quote markup is never chosen — it is Σ profit / Σ cost.

export type QuoteCategory = "units" | "materials" | "labour";
export interface CategoryMarkupRates { units: number; materials: number }
export const DEFAULT_CATEGORY_MARKUPS: CategoryMarkupRates = { units: 25, materials: 100 };

const LABOUR_RE = /\b(labour|labor|installation labour|install(ation)? fee|service call|call[- ]?out|workmanship|fitment)\b/i;
const ACCESSORY_RE = /\b(pump|bolt|nail|disc|compound|washer|screw|tube|tubing|pipe|piping|copper|insulation|armaflex|tape|bracket|kit|cable|trunking|drain|gas|refrigerant|remote|controller|stand|pad|filter|clamp|duct)\b/i;

export function classifyQuoteCategory(p: {
  product_category?: string | null; category?: string | null; item_type?: string | null;
  short_name?: string | null; item_name?: string | null; product_code?: string | null;
  description?: string | null; supplier_type?: string | null; is_bundle?: boolean | null;
} | null | undefined): QuoteCategory {
  if (!p) return "materials";
  const cat = `${p.product_category || ""} ${p.category || ""} ${p.item_type || ""}`.toLowerCase();
  const name = `${p.short_name || ""} ${p.item_name || ""}`.toLowerCase();
  if (/\b(service|labour|labor)\b/.test(cat) || LABOUR_RE.test(name)) return "labour";
  if (p.is_bundle || /kit|consumable|material/.test(cat)) return "materials";
  const acCat = /air ?con|aircon|\bac\b|hvac|split|heat pump/.test(cat) || p.supplier_type === "ac_units" || p.supplier_type === "ac_equipment";
  const blob = `${name} ${p.product_code || ""}`;
  const strongUnit = /\b(inv|inverter|indoor|outdoor|cassette|ducted|concealed|suspended|floor standing|rooftop|mw|wall ?mount|split|fixed speed)\b/i.test(name);
  const accessory = ACCESSORY_RE.test(name) || /\b(knock|nails?|raw)\b/i.test(name);
  if (accessory && !strongUnit) return "materials";
  if (acCat || strongUnit || /\d+\s*k?\s*btu/i.test(blob)) return "units";
  return "materials";
}

/** Pure: markup % for a quote line given the quote's category rates. */
export function categoryMarkupPercent(category: QuoteCategory, rates: CategoryMarkupRates): number {
  if (category === "labour") return 0;
  const v = Number(category === "units" ? rates.units : rates.materials);
  return Number.isFinite(v) ? v : (category === "units" ? DEFAULT_CATEGORY_MARKUPS.units : DEFAULT_CATEGORY_MARKUPS.materials);
}

// Active quote rates — set by QuoteProvider while a quote is open, null otherwise.
let activeRates: CategoryMarkupRates | null = null;
let ratesEditSeq = 0;
const rateListeners = new Set<() => void>();
let rateSnapshot = { rates: activeRates, editSeq: ratesEditSeq };
function emitRates() {
  rateSnapshot = { rates: activeRates, editSeq: ratesEditSeq };
  rateListeners.forEach((l) => l());
}
export function getActiveQuoteMarkupRates() { return activeRates; }
/** `edited=true` only when a user changed the %s — triggers repricing of the quote's lines. */
export function setActiveQuoteMarkupRates(rates: CategoryMarkupRates | null, edited = false) {
  activeRates = rates;
  if (edited) ratesEditSeq++;
  emitRates();
}
export function subscribeQuoteMarkupRates(l: () => void) { rateListeners.add(l); return () => { rateListeners.delete(l); }; }
export function getQuoteMarkupRatesSnapshot() { return rateSnapshot; }
