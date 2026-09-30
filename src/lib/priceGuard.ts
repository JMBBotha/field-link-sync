/**
 * PRICE GUARD: one price rule for every add path, plus the warn-only markup check.
 *   sell = cost x (1 + standard markup / 100), markup ON COST.
 * Standard markup = resolveProductMarkupPercent (inside an open quote the quote/company
 * category rate wins; precedence unchanged). A markup override lives on that quote line
 * only: nothing here writes a product, favourite, company rate or local storage.
 */
import {
  computePricing, lockedPricing, normalizeMarkupPercent, resolveProductMarkupPercent, resolveSupplierCode,
  classifyQuoteCategory, categoryMarkupPercent, getActiveQuoteMarkupRates,
} from "@/lib/pricing";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

/** THE add-path price: cost x (1 + markup/100), same rounding as computePricing. */
export function standardSell(cost: number, markupPct: number): number {
  return computePricing("OTHER", cost, markupPct, cost).sellExVat;
}

/** Unit cost/sell for a product line. Saved (price-locked) lines keep their saved price. */
export function unitPricesFor(product: PaletteProduct, isLengthOverride?: boolean) {
  const isLength = isLengthOverride ?? (product.sold_in_length && !!product.price_per_metre);
  const pq = product.pack_qty && product.pack_qty > 1 && !isLength ? product.pack_qty : 1;
  const pricing = lockedPricing(product)
    ?? computePricing(resolveSupplierCode(product.supplier_name), product.cost_excl_vat || 0, resolveProductMarkupPercent(product), product.cost_price || null);
  const div = isLength ? product.unit_length || 1 : pq;
  return { unitCost: pricing.costExVat / div, unitSell: pricing.sellExVat / div, isPackItem: pq > 1, packQty: pq };
}

/** A product pulled up fresh never carries a previous line's price or override. */
export function freshProduct<T extends object>(p: T): T {
  const { locked_sell_ex_vat: _s, locked_cost_ex_vat: _c, manual_price_override: _m, ...rest } = p as any;
  return rest as T;
}

/** Re-pick: merge into an existing line only when that line is at today's standard price. */
export function canMergeRepick(existing: PaletteProduct, picked: PaletteProduct): boolean {
  if (existing.manual_price_override) return false;
  if (existing.locked_sell_ex_vat == null) return true;
  return Math.abs(unitPricesFor(existing).unitSell - unitPricesFor(freshProduct(picked)).unitSell) <= 0.01;
}

/** Standard markup % for a product (kit = quote materials rate). null = no markup applies (labour) or unknown. */
export function standardMarkupFor(p: Partial<PaletteProduct> | null | undefined, isKit = false): number | null {
  const rates = getActiveQuoteMarkupRates();
  if (isKit) return rates ? categoryMarkupPercent("materials", rates) : null;
  if (!p || (rates && classifyQuoteCategory(p as any) === "labour")) return null;
  return normalizeMarkupPercent(resolveProductMarkupPercent(p as any));
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
const rand = (n: number) => `${n < 0 ? "-" : "+"}R${Math.abs(n).toFixed(2)}`;

/**
 * Warn-only check. sell/cost for the same quantity (units = qty for the R0.01/unit tolerance).
 * Flags only a real difference: more than R0.01 per unit AND at least 0.05 markup points,
 * so cent rounding on long kits is not flagged. Never blocks anything.
 */
export function markupDrift(sell: number, cost: number, standard: number | null, units = 1) {
  if (standard == null || !(cost > 0) || !(sell > 0)) return null;
  const expected = cost * (1 + standard / 100);
  const diffRand = sell - expected;
  const markup = (sell / cost - 1) * 100;
  const diffPct = markup - standard;
  if (Math.abs(diffRand) <= 0.01 * Math.max(1, units) + 1e-9 || Math.abs(diffPct) < 0.05) return null;
  return {
    markup, standard, diffPct, diffRand,
    label: `markup ${pct(markup)} vs standard ${pct(standard)} (${diffPct > 0 ? "+" : ""}${pct(diffPct)}, ${rand(diffRand)})`,
  };
}

/** Warn-only check for a saved quote line. `live` = the catalogue product row, when known. */
export function quoteLineDrift(
  line: { item_type?: string | null; item_name?: string | null; item_number?: string | null; is_bundle?: boolean | null; quantity?: number | null; unit_price?: number | null; metadata?: any },
  live?: Partial<PaletteProduct> | null,
) {
  const md = line.metadata || {};
  if (md.labour || /^(labour|service)$/i.test(String(line.item_type || "")) || md.catalog_service_id) return null;
  const isKit = !!line.is_bundle || !!md.kit;
  const std = standardMarkupFor(isKit ? null : live ?? { product_category: line.item_type, category: line.item_type, short_name: line.item_name, product_code: line.item_number } as any, isKit);
  const qty = Number(line.quantity) || 1;
  const unitCost = Number(md.unit_cost ?? md.cost_excl);
  return markupDrift((Number(line.unit_price) || 0) * qty, unitCost * qty, std, qty);
}
