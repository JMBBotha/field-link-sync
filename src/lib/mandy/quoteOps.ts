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
import { pickInstallTemplate, DEFAULT_INSTALL_KIT_M, type InstallTemplate, type InstallRole } from "@/lib/installTemplates";

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
  /** Install lines added after the unit (excluding the kit). */
  installLines: QuoteItem[];
  /** Human notes, e.g. "Skipped BRAC05 – not in active price books". */
  notes: string[];
  template: InstallTemplate | null;
  kitLength: number | null;
}

/**
 * Insert fields for a normal catalog line — the ONE pricing path
 * (getEffectiveUnitPrices / resolveProductMarkupPercent). Items sold in
 * supplier lengths are stored per LENGTH (qty = lengths, price = one length),
 * never per metre, so "1 × 3 m length" is exactly the book price.
 */
export function catalogLineFields(p: PaletteProduct, qty: number) {
  const perLength = !!(p.sold_in_length && p.unit_length && p.unit_length > 0);
  const { unitCost, unitSell } = getEffectiveUnitPrices(p, perLength ? false : undefined);
  const markupPct = resolveProductMarkupPercent(p);
  const cost = Number(unitCost.toFixed(2));
  const supplierLen = perLength ? Number(p.unit_length) : null;
  return {
    product_id: p.id,
    item_name: p.short_name || p.product_code || "Product",
    item_number: p.product_code || null,
    description: (p as any).ai_sales_description || p.description || null,
    supplier: p.supplier_name || null,
    quantity: qty,
    unit_price: Number(unitSell.toFixed(2)),
    metadata: {
      unit_cost: cost, cost_excl: cost, markup_percent: markupPct,
      ...(supplierLen ? { supplier_length_m: supplierLen, qty_unit: "length" } : {}),
    } as Record<string, any>,
    unitSell,
  };
}

export async function addCatalogProductToQuote(opts: {
  addItem: AddItemFn;
  product: PaletteProduct;
  areaId: string | null;
  sortOrder: number;
  quantity?: number;
  bundles?: BundleForKit[];
  source?: string;
  /** Standard install templates; when given, AC units get the full standard install. */
  templates?: InstallTemplate[];
  /** Live catalog rows used to resolve install product codes. */
  liveProducts?: PaletteProduct[];
}): Promise<AddProductResult> {
  const { addItem, product: p, areaId, bundles = [] } = opts;
  const qty = opts.quantity && opts.quantity > 0 ? opts.quantity : 1;
  const f = catalogLineFields(p, qty);
  const { unitSell, ...fields } = f;
  const line = await addItem({
    ...baseItem(),
    ...fields,
    area_id: areaId,
    sort_order: opts.sortOrder,
    source: opts.source || "catalog",
  });
  const empty: AddProductResult = { line, kit: null, kitName: null, unitSell, kitSellPerMetre: null, installLines: [], notes: [], template: null, kitLength: null };
  if (!line || !isAirConditioningProduct(p)) return empty;
  const inst = await addStandardInstall({
    addItem, unitLine: line, product: p, areaId, sortOrder: opts.sortOrder + 1,
    templates: opts.templates || [], bundles, liveProducts: opts.liveProducts || [], source: opts.source,
  });
  return { ...empty, ...inst };
}

/**
 * Standard install for an AC unit: template by BTU → piping kit (collapsed,
 * price-locked, at the template length) + each other item as its own normal
 * catalog line, all tagged metadata.install = { unit_item_id, role, template_id }.
 * No template → today's kit-only rule (findPipingKitForBtu) at 3 m.
 */
export interface InstallPlan {
  template: InstallTemplate | null;
  kitBundle: BundleForKit | null;
  kitLength: number;
  lines: { role: InstallRole; product: PaletteProduct; qty: number }[];
  notes: string[];
}

/** The ONE standard-install rule (used by quote writes AND the clickable builder's basket). */
export function planStandardInstall(product: Partial<PaletteProduct>, templates: InstallTemplate[], bundles: BundleForKit[], liveProducts: PaletteProduct[]): InstallPlan {
  const btu = extractBtu(product as any);
  const tpl = pickInstallTemplate(templates, btu);
  const notes: string[] = [];
  const lines: InstallPlan["lines"] = [];
  if (!tpl) return { template: null, kitBundle: findPipingKitForBtu(bundles, btu), kitLength: DEFAULT_INSTALL_KIT_M, lines, notes };
  let kitBundle: BundleForKit | null = null, kitLength = DEFAULT_INSTALL_KIT_M;
  for (const it of tpl.items) {
    if (!it.included) continue;
    if (it.role === "piping_kit") {
      kitBundle = (it.bundle_id && bundles.find((x) => x.id === it.bundle_id)) || findPipingKitForBtu(bundles, btu);
      kitLength = it.default_length_m || DEFAULT_INSTALL_KIT_M;
      if (!kitBundle) notes.push("Skipped piping kit – kit not found");
      continue;
    }
    const code = String(it.product_code || "").trim().toUpperCase();
    const prod = code ? liveProducts.find((x) => String(x.product_code || "").trim().toUpperCase() === code) : null;
    if (!prod) { notes.push(`Skipped ${code || it.role} – not in active price books`); continue; }
    lines.push({ role: it.role, product: prod, qty: it.default_qty || 1 });
  }
  return { template: tpl, kitBundle, kitLength, lines, notes };
}

/**
 * Standard install for an AC unit: template by BTU → piping kit (collapsed,
 * price-locked, at the template length) + each other item as its own normal
 * catalog line, all tagged metadata.install = { unit_item_id, role, template_id }.
 * No template → today's kit-only rule (findPipingKitForBtu) at 3 m.
 */
export async function addStandardInstall(opts: {
  addItem: AddItemFn;
  unitLine: QuoteItem;
  product: PaletteProduct;
  areaId: string | null;
  sortOrder: number;
  templates: InstallTemplate[];
  bundles: BundleForKit[];
  liveProducts: PaletteProduct[];
  source?: string;
}) {
  const { addItem, unitLine, areaId } = opts;
  const plan = planStandardInstall(opts.product, opts.templates, opts.bundles, opts.liveProducts);
  const tpl = plan.template;
  const notes = [...plan.notes];
  const installLines: QuoteItem[] = [];
  let sort = opts.sortOrder;
  let kit: QuoteItem | null = null, kitName: string | null = null, kitSellPerMetre: number | null = null, kitLength: number | null = null;
  const tag = (role: InstallRole) => ({ install: { unit_item_id: unitLine.id, role, template_id: tpl?.id ?? null } });

  if (plan.kitBundle) {
    const k = await addKitToQuote({ addItem, bundle: plan.kitBundle, areaId, sortOrder: sort++, source: opts.source, length: plan.kitLength, extraMeta: tag("piping_kit") });
    kit = k.kit; kitName = k.kitName; kitSellPerMetre = k.kitSellPerMetre; kitLength = k.length;
  }
  for (const l of plan.lines) {
    const { unitSell: _u, ...fields } = catalogLineFields(l.product, l.qty);
    const row = await addItem({
      ...baseItem(),
      ...fields,
      metadata: { ...fields.metadata, ...tag(l.role) },
      area_id: areaId,
      sort_order: sort++,
      source: opts.source || "catalog",
    });
    if (row) installLines.push(row);
    else notes.push(`Couldn't add ${l.product.product_code}`);
  }
  return { kit, kitName, kitSellPerMetre, installLines, notes, template: tpl, kitLength };
}

/** Add a piping kit row — the exact collapsed, price-locked row the builder adds with an AC unit. */
export async function addKitToQuote(opts: { addItem: AddItemFn; bundle: BundleForKit; areaId: string | null; sortOrder: number; source?: string; length?: number; extraMeta?: Record<string, any> }) {
  const { addItem, bundle, areaId } = opts;
  const m = buildKitMaterial(bundle as any, 1);
  const f = kitBasketFields(m);
  const len = m.pricingMode === "length" ? (opts.length && opts.length > 0 ? opts.length : m.adjustedLength) : 1;
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
      ...(opts.extraMeta || {}),
    },
    sort_order: opts.sortOrder,
    source: opts.source || "catalog",
  });
  return { kit, kitName: bundle.name, kitSellPerMetre: f.bundleUnitPrice || 0, length: m.pricingMode === "length" ? len : null };
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
