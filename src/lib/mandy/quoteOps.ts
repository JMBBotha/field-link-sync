/**
 * Shared "add a catalog product to the open quote" path.
 *
 * Used by the estimate page's product picker (QuoteQuickEditor) AND by Mandy,
 * so a voice add is byte-for-byte the same as tapping the product. Pricing
 * comes only from getEffectiveUnitPrices / resolveProductMarkupPercent (active
 * quote category rates) and the kit pricing in kitLine.ts — no formula here.
 */
import { getEffectiveUnitPrices, type PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import { resolveProductMarkupPercent } from "@/lib/pricing";
import { extractBtu } from "@/lib/bundles";
import { buildKitMaterial, kitBasketFields } from "@/components/catalog/quote-builder/kitLine";
import { searchAndRankProducts, scoreProductMatch, normalizeQuery } from "@/components/catalog/searchSynonyms";
import type { QuoteItem, QuoteItemInsert } from "@/types/quote";

type AddItemFn = (item: Omit<QuoteItemInsert, "quote_id">) => Promise<QuoteItem | null>;

export interface BundleForKit {
  id: string;
  name: string;
  description?: string | null;
  min_btu?: number | null;
  max_btu?: number | null;
  items: any[];
}

export function isAirConditioningProduct(product: Partial<PaletteProduct>): boolean {
  const blob = [product.product_category, product.category, product.short_name, product.description]
    .filter(Boolean).join(" ").toLowerCase();
  return blob.includes("air conditioning") || blob.includes("aircon");
}

/** Same rule as QuoteBuilderTab.findPipingKitForBtu (BTU range, then "24K" in the name). */
export function findPipingKitForBtu(bundles: BundleForKit[], btu: number | null): BundleForKit | null {
  if (!btu || btu <= 0) return null;
  const k = Math.round(btu / 1000);
  const re = new RegExp(`\\b(?:${k}K|${String(k).padStart(2, "0")}K)\\b`, "i");
  const piping = bundles.filter((b) => [b.name, b.description].filter(Boolean).join(" ").toUpperCase().includes("PIPING"));
  return (
    piping.find((b) => b.min_btu != null && b.max_btu != null && btu >= b.min_btu && btu <= b.max_btu) ||
    piping.find((b) => re.test([b.name, b.description].filter(Boolean).join(" "))) ||
    null
  );
}

const baseItem = (): Omit<QuoteItemInsert, "quote_id" | "item_name" | "unit_price" | "sort_order"> => ({
  area_id: null, parent_item_id: null, product_id: null, item_number: null, description: null,
  quantity: 1, length: null, total_price: null, is_bundle: false, item_type: "product",
  metadata: {}, notes: null, source: "manual", supplier: null,
});

export interface AddProductResult {
  line: QuoteItem | null;
  kit: QuoteItem | null;
  kitName: string | null;
  unitSell: number;
  kitSellPerMetre: number | null;
}

export async function addCatalogProductToQuote(opts: {
  addItem: AddItemFn;
  product: PaletteProduct;
  areaId: string | null;
  sortOrder: number;
  quantity?: number;
  bundles?: BundleForKit[];
  source?: string;
}): Promise<AddProductResult> {
  const { addItem, product: p, areaId, bundles = [] } = opts;
  const qty = opts.quantity && opts.quantity > 0 ? opts.quantity : 1;
  const { unitCost, unitSell } = getEffectiveUnitPrices(p);
  const markupPct = resolveProductMarkupPercent(p);
  const cost = Number(unitCost.toFixed(2));
  const line = await addItem({
    ...baseItem(),
    area_id: areaId,
    product_id: p.id,
    item_name: p.short_name || p.product_code || "Product",
    item_number: p.product_code || null,
    description: (p as any).ai_sales_description || p.description || null,
    supplier: p.supplier_name || null,
    quantity: qty,
    unit_price: Number(unitSell.toFixed(2)),
    metadata: { unit_cost: cost, cost_excl: cost, markup_percent: markupPct },
    sort_order: opts.sortOrder,
    source: opts.source || "catalog",
  });

  let kit: QuoteItem | null = null;
  let kitName: string | null = null;
  let kitSellPerMetre: number | null = null;
  const bundle = line && isAirConditioningProduct(p) ? findPipingKitForBtu(bundles, extractBtu(p as any)) : null;
  if (bundle) {
    const m = buildKitMaterial(bundle as any, 1);
    const f = kitBasketFields(m);
    const len = m.pricingMode === "length" ? m.adjustedLength : 1;
    const sell = Number(((f.bundleUnitPrice || 0) * len).toFixed(2));
    const kCost = Number(((f.bundleUnitCost || 0) * len).toFixed(2));
    kitSellPerMetre = f.bundleUnitPrice || 0;
    kitName = bundle.name;
    kit = await addItem({
      ...baseItem(),
      area_id: areaId,
      item_name: bundle.name,
      item_number: m.product.product_code || null,
      description: m.product.description || null,
      quantity: 1,
      length: m.pricingMode === "length" ? len : null,
      unit_price: sell,
      total_price: sell,
      is_bundle: true,
      item_type: "Installation Kit",
      metadata: {
        unit_cost: kCost,
        cost_excl: kCost,
        total_cost: kCost,
        markup_percent: kCost > 0 ? Number((((sell - kCost) / kCost) * 100).toFixed(2)) : 0,
        price_locked: true,
        kit: { bundle_id: bundle.id, name: bundle.name, pricing_type: f.bundlePricingType, unit_cost: f.bundleUnitCost ?? 0, items: f.kitContents ?? [] },
      },
      sort_order: opts.sortOrder + 1,
      source: opts.source || "catalog",
    });
  }
  return { line, kit, kitName, unitSell, kitSellPerMetre };
}

/** Patch for a saved kit row when its length changes (same maths as withKitLength). */
export function kitLengthPatch(item: { unit_price?: number | null; length?: number | null; metadata?: any }, metres: number) {
  const v = Math.max(0.5, metres);
  const oldLen = Number(item.length) || 1;
  const perM = (Number(item.unit_price) || 0) / oldLen;
  const kitCostPerM = Number(item.metadata?.kit?.unit_cost) || (Number(item.metadata?.unit_cost) || 0) / oldLen;
  const sell = Number((perM * v).toFixed(2));
  const cost = Number((kitCostPerM * v).toFixed(2));
  return {
    length: v,
    unit_price: sell,
    total_price: sell,
    metadata: { ...(item.metadata || {}), unit_cost: cost, cost_excl: cost, total_cost: cost },
  };
}

/** Normalise spoken product words for the catalog ranker: "24000" → "24k", "inverter" → "inv". */
export function normaliseSpokenProduct(q: string): string {
  return q
    .replace(/\b(\d{1,2})[ ,]?000(\s*btu)?\b/gi, "$1k")
    .replace(/\b(\d{1,2})\s*k\s*btu\b/gi, "$1k")
    .replace(/\binverter\b/gi, "inv")
    .replace(/\b(a|an|the|unit|aircon|air ?conditioner)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rank the live catalog; `tie` = more than one equally good hit (show chips). */
export function matchSpokenProduct(query: string, products: PaletteProduct[]) {
  const q = normaliseSpokenProduct(query);
  const ranked = searchAndRankProducts(q, products as any[]) as PaletteProduct[];
  if (!ranked.length) return { ranked, tie: false, query: q };
  const nq = normalizeQuery(q);
  const s0 = scoreProductMatch(nq, ranked[0] as any);
  const s1 = ranked[1] ? scoreProductMatch(nq, ranked[1] as any) : -1;
  return { ranked: ranked.slice(0, 5), tie: s1 >= 0 && s1 >= s0 - 10 && s0 < 900, query: q };
}
