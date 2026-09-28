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
import { kitItemPerMetre } from "@/lib/lineDisplay";
import { buildKitMaterial, kitBasketFields, DEFAULT_KIT_LENGTH_M } from "@/components/catalog/quote-builder/kitLine";
import { pickKitForUnit } from "@/lib/kitSizes";
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

export const baseItem = (): Omit<QuoteItemInsert, "quote_id" | "item_name" | "unit_price" | "sort_order"> => ({
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
  if (supplierLen && isPerMetreTrunking(p)) {
    // Trunking is quoted per METRE: the book price of one length ÷ its metres (qty = metres).
    const lengthSell = Number(unitSell.toFixed(2));
    return {
      product_id: p.id,
      item_name: p.short_name || p.product_code || "Product",
      item_number: p.product_code || null,
      description: (p as any).ai_sales_description || p.description || null,
      supplier: p.supplier_name || null,
      quantity: qty,
      unit_price: r4(lengthSell / supplierLen),
      total_price: perMetreTotal(qty, lengthSell, supplierLen),
      metadata: {
        unit_cost: r4(cost / supplierLen), cost_excl: r4(cost / supplierLen), markup_percent: markupPct,
        supplier_length_m: supplierLen, qty_unit: "metre",
      } as Record<string, any>,
      unitSell: lengthSell / supplierLen,
    };
  }
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

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Trunking sold in supplier lengths (sold_in_length + unit_length + "trunking" in the name) — quoted per metre. */
export function isPerMetreTrunking(p: { sold_in_length?: boolean | null; unit_length?: number | null; short_name?: string | null; description?: string | null; product_code?: string | null } | null | undefined): boolean {
  if (!p || !p.sold_in_length || !(Number(p.unit_length) > 0)) return false;
  return /trunking/i.test(`${p.short_name || ""} ${p.product_code || ""}`) && !/end\s*cap/i.test(p.short_name || "");
}

/** Line total for metres of per-metre trunking: round(metres × length sell ÷ length, 2) — 3 m of a R264.50 length = R264.50. */
export function perMetreTotal(metres: number, lengthSell: number, lengthM: number): number {
  return Math.round(((metres * lengthSell) / lengthM) * 100 + 1e-9) / 100;
}

/** Saved line is per-metre trunking (new shape). Old lines (qty_unit 'length' / missing) stay per length. */
export const isMetreLine = (i: { metadata?: any } | null | undefined) => i?.metadata?.qty_unit === "metre";

/** Total of a saved per-metre line at `metres` (from its stored per-metre price). */
export function metreLineTotal(i: { unit_price?: number | null; metadata?: any }, metres: number): number {
  const L = Number(i.metadata?.supplier_length_m) || 3;
  const lengthSell = Math.round((Number(i.unit_price) || 0) * L * 100) / 100;
  return perMetreTotal(metres, lengthSell, L);
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
  /** Spoken overrides for the standard install (kit metres, qty per product code). */
  kitLengthM?: number | null;
  qtyByCode?: Record<string, number>;
}): Promise<AddProductResult> {
  const { addItem, product: p, areaId, bundles = [] } = opts;
  const qty = opts.quantity && opts.quantity > 0 ? opts.quantity : isPerMetreTrunking(p) ? Number(p.unit_length) : 1;
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
    kitLengthM: opts.kitLengthM, qtyByCode: opts.qtyByCode,
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
  // Unit lists its pipe sizes → prefer a kit whose copper matches (never invented; null when not filled).
  const pick = pickKitForUnit(bundles as any[], product as any, { allUnits: liveProducts as any[], btuOf: (u) => extractBtu(u as any) });
  const pipeKit = pick.reason !== "btu" ? (pick.kit as BundleForKit | null) : null;
  if (pick.note && pipeKit) notes.push(pick.note);
  if (!tpl) {
    const k = pipeKit || findPipingKitForBtu(bundles, btu);
    notes.push(btu ? `No standard install template for ${Math.round(btu / 1000)}K${k ? " – kit only" : ", and no piping kit found"}` : "No BTU on this unit, so no standard install was added");
    return { template: null, kitBundle: btu ? k : null, kitLength: DEFAULT_INSTALL_KIT_M, lines, notes };
  }
  let kitBundle: BundleForKit | null = null, kitLength = DEFAULT_INSTALL_KIT_M;
  for (const it of tpl.items) {
    if (!it.included) continue;
    if (it.role === "piping_kit") {
      kitBundle = pipeKit || (it.bundle_id && bundles.find((x) => x.id === it.bundle_id)) || findPipingKitForBtu(bundles, btu);
      kitLength = it.default_length_m || DEFAULT_INSTALL_KIT_M;
      if (!kitBundle) notes.push("Skipped piping kit – kit not found");
      continue;
    }
    const code = String(it.product_code || "").trim().toUpperCase();
    const prod = code ? liveProducts.find((x) => String(x.product_code || "").trim().toUpperCase() === code) : null;
    if (!prod) { notes.push(`Skipped ${code || it.role} – not in active price books`); continue; }
    // Per-metre trunking: default_length_m as metres, else default_qty lengths × unit length.
    const qty = isPerMetreTrunking(prod) ? (it.default_length_m && it.default_length_m > 0 ? it.default_length_m : (it.default_qty || 1) * Number(prod.unit_length)) : it.default_qty || 1;
    lines.push({ role: it.role, product: prod, qty });
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
  kitLengthM?: number | null;
  qtyByCode?: Record<string, number>;
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
    const k = await addKitToQuote({ addItem, bundle: plan.kitBundle, areaId, sortOrder: sort++, source: opts.source, length: opts.kitLengthM && opts.kitLengthM > 0 ? opts.kitLengthM : plan.kitLength, extraMeta: tag("piping_kit") });
    kit = k.kit; kitName = k.kitName; kitSellPerMetre = k.kitSellPerMetre; kitLength = k.length;
  }
  for (const l of plan.lines) {
    const override = opts.qtyByCode?.[String(l.product.product_code || "").trim().toUpperCase()];
    const { unitSell: _u, ...fields } = catalogLineFields(l.product, override && override > 0 ? override : l.qty);
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

/** Row fields for a collapsed, price-locked kit at `length` m — shared by add and swap (same maths). */
export function kitRowFields(bundle: BundleForKit, length?: number) {
  const m = buildKitMaterial(bundle as any, 1);
  const f = kitBasketFields(m);
  const len = m.pricingMode === "length" ? (length && length > 0 ? length : DEFAULT_KIT_LENGTH_M) : 1;
  const sell = Number(((f.bundleUnitPrice || 0) * len).toFixed(2));
  const kCost = Number(((f.bundleUnitCost || 0) * len).toFixed(2));
  return {
    fields: {
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
        kit: {
          bundle_id: bundle.id, name: bundle.name, pricing_type: f.bundlePricingType, unit_cost: f.bundleUnitCost ?? 0, unit_sell: Number((f.bundleUnitPrice ?? 0).toFixed(2)),
          ...(m.pricingMode === "length" ? { length_m: len } : {}),
          items: scaleKitItems(f.kitContents ?? [], f.bundlePricingType, m.pricingMode === "length" ? len : null),
        },
      } as Record<string, any>,
    },
    perMetre: f.bundleUnitPrice || 0,
    length: m.pricingMode === "length" ? len : null,
  };
}

/** Add a piping kit row — the exact collapsed, price-locked row the builder adds with an AC unit. */
export async function addKitToQuote(opts: { addItem: AddItemFn; bundle: BundleForKit; areaId: string | null; sortOrder: number; source?: string; length?: number; extraMeta?: Record<string, any> }) {
  const { addItem, bundle, areaId } = opts;
  const r = kitRowFields(bundle, opts.length);
  const kit = await addItem({
    ...baseItem(),
    ...r.fields,
    area_id: areaId,
    metadata: { ...r.fields.metadata, ...(opts.extraMeta || {}) },
    sort_order: opts.sortOrder,
    source: opts.source || "catalog",
  });
  return { kit, kitName: bundle.name, kitSellPerMetre: r.perMetre, length: r.length };
}

/** Swap a saved kit row to another kit: same metres, repriced from the book, install tag kept. */
export function kitSwapPatch(cur: { length?: number | null; metadata?: any }, bundle: BundleForKit) {
  const r = kitRowFields(bundle, Number(cur.length) || DEFAULT_KIT_LENGTH_M);
  const keep = cur.metadata?.install ? { install: cur.metadata.install } : {};
  return { ...r.fields, metadata: { ...r.fields.metadata, ...keep }, perMetre: r.perMetre };
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

/**
 * Kit contents normalised to qty_per_m (per-metre kits) and quantity scaled to `metres`.
 * Legacy snapshots: length items were per metre, count items (cable ties) × 3 m — see kitItemPerMetre.
 */
export function scaleKitItems(items: any[], pricingType: string | null | undefined, metres: number | null): any[] {
  if (pricingType !== "p/meter" || metres == null) return items;
  return (items || []).map((i) => {
    const per = kitItemPerMetre(i, pricingType);
    return { ...i, qty_per_m: per, quantity: Math.round(per * metres * 1000) / 1000 };
  });
}

/** Patch for a saved kit row when its length changes (same maths as withKitLength). */
export function kitLengthPatch(item: { unit_price?: number | null; length?: number | null; metadata?: any }, metres: number) {
  const v = Math.max(0.1, metres);
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
    metadata: {
      ...md, unit_cost: cost, cost_excl: cost, total_cost: cost,
      ...(md.kit ? { kit: { ...md.kit, unit_sell: Number(perM.toFixed(2)), length_m: v, items: scaleKitItems(md.kit.items || [], md.kit.pricing_type, v) } } : {}),
    },
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

/**
 * Builder/wizard basket line for one standard-install item. Price is LOCKED to
 * exactly what catalogLineFields gives a quote write (whole supplier length),
 * so every path shows the same number.
 */
export function installBasketItem(l: InstallPlan["lines"][number], unitKey: string, templateId: string | null) {
  const f = catalogLineFields(l.product, l.qty);
  const cost = Number((f.metadata as any)?.unit_cost) || null;
  const supplierLen = Number((f.metadata as any)?.supplier_length_m) || null;
  const metre = (f.metadata as any)?.qty_unit === "metre";
  // Per-metre trunking: lock ONE length's sell/cost and price per that many metres
  // (computeLineTotal: metres ÷ L × length sell) so 3 m = the exact book price.
  const L = supplierLen || 1;
  const unit = metre ? { unit_type: "m", price_per_unit_qty: L, price_per_unit_label: `${L} m`, allows_decimal_qty: true, qty_step: 0.1, min_qty: 0 } : {};
  const sell = metre ? Math.round(f.unit_price * L * 100) / 100 : f.unit_price;
  const lockedCost = metre && cost != null ? Math.round(cost * L * 100) / 100 : cost;
  return {
    instanceId: `${unitKey}-${l.role}`,
    product: { ...l.product, ...unit, sold_in_length: false, price_per_metre: null, locked_sell_ex_vat: sell, locked_cost_ex_vat: lockedCost } as PaletteProduct,
    quantity: l.qty,
    install: { unitKey, role: l.role, template_id: templateId, supplier_length_m: supplierLen, ...(metre ? { qty_unit: "metre" as const } : {}) },
  };
}
