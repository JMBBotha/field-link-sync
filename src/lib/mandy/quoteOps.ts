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
import { matchCatalog } from "@/lib/mandy/catalogMatch";
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

  const bundle = line && isAirConditioningProduct(p) ? findPipingKitForBtu(bundles, extractBtu(p as any)) : null;
  const k = bundle ? await addKitToQuote({ addItem, bundle, areaId, sortOrder: opts.sortOrder + 1, source: opts.source }) : null;
  const kit = k?.kit ?? null, kitName = k?.kitName ?? null, kitSellPerMetre = k?.kitSellPerMetre ?? null;
  return { line, kit, kitName, unitSell, kitSellPerMetre };
}

/** Add a piping kit row at its default length — the exact row the builder auto-adds with an AC unit. */
export async function addKitToQuote(opts: { addItem: AddItemFn; bundle: BundleForKit; areaId: string | null; sortOrder: number; source?: string }) {
  const { addItem, bundle, areaId } = opts;
  const m = buildKitMaterial(bundle as any, 1);
  const f = kitBasketFields(m);
  const len = m.pricingMode === "length" ? m.adjustedLength : 1;
  const sell = Number(((f.bundleUnitPrice || 0) * len).toFixed(2));
  const kCost = Number(((f.bundleUnitCost || 0) * len).toFixed(2));
  const kit = await addItem({
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
      kit: { bundle_id: bundle.id, name: bundle.name, pricing_type: f.bundlePricingType, unit_cost: f.bundleUnitCost ?? 0, unit_sell: Number((f.bundleUnitPrice ?? 0).toFixed(2)), items: f.kitContents ?? [] },
    },
    sort_order: opts.sortOrder,
    source: opts.source || "catalog",
  });
  return { kit, kitName: bundle.name, kitSellPerMetre: f.bundleUnitPrice || 0 };
}

/**
 * Per-metre SELL rate of a saved kit row. Never derived from unit_price ÷ length
 * alone: a row whose length was written without repricing (e.g. length 5 with a
 * 1 m price) would then yield a fraction of the real rate. Order:
 * stored kit.unit_sell → kit.unit_cost × (1 + saved markup) → unit_price ÷ length.
 */
export function kitSellPerMetre(item: { unit_price?: number | null; length?: number | null; metadata?: any }): number {
  const k = item.metadata?.kit || {};
  const stored = Number(k.unit_sell);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const saved = (Number(item.unit_price) || 0) / (Number(item.length) || 1);
  const costM = Number(k.unit_cost);
  const mk = Number(item.metadata?.markup_percent);
  if (!(Number.isFinite(costM) && costM > 0 && Number.isFinite(mk))) return saved;
  const fromCost = costM * (1 + mk / 100);
  // Saved rate wins (price lock) unless it has drifted away from cost × markup.
  return Math.abs(saved - fromCost) <= Math.max(0.05, fromCost * 0.01) ? saved : Number(fromCost.toFixed(2));
}

/** Patch for a saved kit row when its length changes (same maths as withKitLength). */
export function kitLengthPatch(item: { unit_price?: number | null; length?: number | null; metadata?: any }, metres: number) {
  const v = Math.max(0.5, metres);
  const oldLen = Number(item.length) || 1;
  const perM = kitSellPerMetre(item);
  const kitCostPerM = Number(item.metadata?.kit?.unit_cost) || (Number(item.metadata?.unit_cost) || 0) / oldLen;
  const sell = Number((perM * v).toFixed(2));
  const cost = Number((kitCostPerM * v).toFixed(2));
  const md = item.metadata || {};
  return {
    length: v,
    unit_price: sell,
    total_price: sell,
    metadata: { ...md, unit_cost: cost, cost_excl: cost, total_cost: cost, ...(md.kit ? { kit: { ...md.kit, unit_sell: Number(perM.toFixed(2)) } } : {}) },
  };
}

export { normaliseSpokenProduct } from "@/lib/mandy/catalogMatch";

/** Rank the live catalog through the ONE shared matcher; `tie` = no single strong match (show chips). */
export function matchSpokenProduct(query: string, products: PaletteProduct[]) {
  const m = matchCatalog(query, products as any[]);
  const ranked = m.ranked.map((h) => (h as any).product as PaletteProduct);
  return { ranked: m.pick ? ranked.slice(0, 5) : ranked.slice(0, 3), tie: !m.pick && ranked.length > 0, query: m.query, match: m };
}

/** BTU of the AC unit already in an area (for "piping bundle" with no size). */
export function areaUnitBtu(items: { area_id?: string | null; product_id?: string | null; parent_item_id?: string | null }[], products: any[], areaId?: string | null): number | null {
  if (!areaId) return null;
  for (const i of items) {
    if (i.area_id !== areaId || i.parent_item_id || !i.product_id) continue;
    const p = products.find((x) => x.id === i.product_id);
    if (p && isAirConditioningProduct(p)) { const b = extractBtu(p); if (b) return b; }
  }
  return null;
}
