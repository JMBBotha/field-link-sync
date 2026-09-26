/**
 * Installation kit (bundle) → ONE collapsed area line.
 *
 * Why: dropping a bundle used to explode it into separate material lines,
 * each at its own default length (usually 3 m) and — for length items whose
 * product wasn't flagged sold_in_length — at the FULL coil price. A kit that
 * the palette shows at R493/m therefore landed in the quote at ~R3 000 for
 * "1 m". The palette price is the contract: a kit line must cost exactly
 * computeBundlePricing(...).unitPrice × length.
 *
 * The line carries a synthetic, PRICE-LOCKED product (per-metre sell locked),
 * so every generic pricing path (getEffectiveUnitPrices, computeProductPricing,
 * calculateBasketItemSell) yields the same number without special cases.
 */
import type { PaletteProduct } from "../QuoteBuilderTab";
import type { AreaMaterial, AreaKitInfo } from "./quoteWizardTypes";
import { computeBundlePricing, type BundleSubItem } from "./BundleItemsPopover";

interface BundleLike {
  id: string;
  name: string;
  items: Array<{
    id?: string;
    quantity?: number;
    length_metres?: number | null;
    is_length_item?: boolean | null;
    is_optional?: boolean | null;
    product?: PaletteProduct | null;
    supplier_product?: PaletteProduct | null;
  }>;
}

export const DEFAULT_KIT_LENGTH_M = 3;

export function buildKitSubItems(bundle: BundleLike): BundleSubItem[] {
  return (bundle.items || [])
    .filter((b) => b.product || b.supplier_product)
    .map((b) => {
      const product = (b.product || b.supplier_product) as PaletteProduct;
      const isLengthItem = !!b.is_length_item && !!product.price_per_metre;
      return {
        product,
        quantity: b.quantity || 1,
        isLengthItem,
        isOptional: !!b.is_optional,
        ...(isLengthItem ? { length: b.length_metres || product.unit_length || 1 } : {}),
      };
    });
}

/** Synthetic price-locked product that represents the whole kit. */
export function kitProduct(kit: AreaKitInfo, bundleId: string): PaletteProduct {
  const perMetre = kit.pricingType === "p/meter";
  return {
    id: `kit-${bundleId}`,
    product_code: `KIT-${bundleId.slice(0, 6).toUpperCase()}`,
    short_name: kit.name,
    brand: "",
    product_category: "Installation Kit",
    category: "Installation Kit",
    description: `Installation kit: ${kit.name} (${kit.items.length} items)`,
    cost_price: kit.unitCost,
    cost_excl_vat: kit.unitCost,
    cost_incl_vat: 0,
    selling_price: kit.unitSell,
    default_markup_percent: kit.unitCost > 0 ? ((kit.unitSell - kit.unitCost) / kit.unitCost) * 100 : 0,
    markup_percent: null,
    supplier_discount_percent: null,
    is_pinned: false,
    pin_order: null,
    supplier_name: "",
    supplier_type: "both",
    price_per_metre: perMetre ? kit.unitSell : null,
    sold_in_length: perMetre,
    unit_length: perMetre ? 1 : null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
    locked_sell_ex_vat: kit.unitSell,
    locked_cost_ex_vat: kit.unitCost,
  } as PaletteProduct;
}

/** Build the single collapsed kit line for an area. */
export function buildKitMaterial(bundle: BundleLike, lengthM: number = DEFAULT_KIT_LENGTH_M): AreaMaterial {
  const subItems = buildKitSubItems(bundle);
  const { pricingType, unitPrice, unitCost } = computeBundlePricing(subItems);
  const kit: AreaKitInfo = {
    name: bundle.name,
    pricingType,
    unitSell: unitPrice,
    unitCost,
    items: subItems
      .filter((s) => !s.isOptional)
      .map((s) => ({
        name: s.product.short_name || s.product.product_code || "Item",
        code: s.product.product_code || null,
        quantity: s.quantity,
        isLengthItem: s.isLengthItem,
      })),
  };
  return materialFromKit(kit, bundle.id, `kit-${bundle.id}`, lengthM);
}

export function materialFromKit(kit: AreaKitInfo, bundleId: string, id: string, lengthOrQty: number): AreaMaterial {
  const perMetre = kit.pricingType === "p/meter";
  const qty = lengthOrQty > 0 ? lengthOrQty : 1;
  return {
    id,
    product: kitProduct(kit, bundleId),
    defaultLength: perMetre ? qty : 1,
    adjustedLength: perMetre ? qty : 1,
    costPerMeter: kit.unitSell,
    totalCost: kit.unitSell * qty,
    pricingMode: perMetre ? "length" : "unit",
    unitQuantity: perMetre ? 1 : qty,
    fromBundle: true,
    bundleId,
    kit,
  };
}

/** Re-price a kit line after its length (or qty) changes. */
export function withKitLength(m: AreaMaterial, value: number): AreaMaterial {
  if (!m.kit) return m;
  const v = Math.max(0.5, value);
  return m.pricingMode === "length"
    ? { ...m, adjustedLength: v, totalCost: m.kit.unitSell * v }
    : { ...m, unitQuantity: Math.round(v), totalCost: m.kit.unitSell * Math.round(v) };
}

/** Extra BasketItem fields so a kit line persists as ONE bundle row. */
export function kitBasketFields(m: AreaMaterial): {
  isBundle?: true;
  bundleId?: string;
  bundleName?: string;
  bundlePricingType?: "p/meter" | "p/qty";
  bundleUnitPrice?: number;
  bundleUnitCost?: number;
  kitContents?: AreaKitInfo["items"];
} {
  if (!m.kit) return {};
  return {
    isBundle: true,
    bundleId: m.bundleId,
    bundleName: m.kit.name,
    bundlePricingType: m.kit.pricingType,
    bundleUnitPrice: m.kit.unitSell,
    bundleUnitCost: m.kit.unitCost,
    kitContents: m.kit.items,
  };
}

/**
 * Rebuild a collapsed kit line from a saved quote_item. The SAVED unit_price
 * is authoritative (price lock) — we derive the per-metre / per-kit rate from
 * it rather than re-pricing from today's catalog.
 */
export function kitFromSavedItem(it: {
  id: string;
  is_bundle?: boolean | null;
  length?: number | null;
  quantity?: number | null;
  unit_price?: number | null;
  metadata?: Record<string, unknown> | null;
}): AreaMaterial | null {
  if (!it.is_bundle) return null;
  const k = (it.metadata as { kit?: Record<string, unknown> } | null)?.kit;
  if (!k || typeof k !== "object") return null;
  const pricingType = k.pricing_type === "p/qty" ? "p/qty" : "p/meter";
  const unitPrice = Number(it.unit_price) || 0;
  const length = Number(it.length) || 0;
  const qty = Number(it.quantity) || 1;
  const unitSell = pricingType === "p/meter" ? (length > 0 ? unitPrice / length : unitPrice) : unitPrice;
  const kit: AreaKitInfo = {
    name: String(k.name || "Installation kit"),
    pricingType,
    unitSell,
    unitCost: pricingType === "p/meter" && length > 0 ? (Number(k.unit_cost) || 0) : Number(k.unit_cost) || 0,
    items: Array.isArray(k.items) ? (k.items as AreaKitInfo["items"]) : [],
  };
  const bundleId = String(k.bundle_id || it.id);
  return materialFromKit(kit, bundleId, it.id, pricingType === "p/meter" ? (length || 1) : qty);
}

/* ─── Collapse pre-collapse (exploded) kits on hydrate ─────────────────── */

interface SavedLineLike {
  id: string;
  item_number?: string | null;
  item_name?: string | null;
  is_bundle?: boolean | null;
  length?: number | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  metadata?: Record<string, unknown> | null;
}

interface BundleForCollapse {
  id: string;
  name: string;
  items: Array<{
    quantity?: number | null;
    is_length_item?: boolean | null;
    is_optional?: boolean | null;
    product?: { product_code?: string | null; short_name?: string | null } | null;
    supplier_product?: { product_code?: string | null; short_name?: string | null } | null;
  }>;
}

const norm = (s?: string | null) => (s || "").trim().toUpperCase();

function lineSell(l: SavedLineLike): number {
  const t = Number(l.total_price);
  if (Number.isFinite(t) && t > 0) return t;
  return (Number(l.unit_price) || 0) * (Number(l.quantity) || 1);
}

function lineCost(l: SavedLineLike): number {
  const meta = (l.metadata || {}) as Record<string, unknown>;
  const qty = Number(l.quantity) || 1;
  const uc = Number(meta.unit_cost ?? meta.cost_excl);
  if (Number.isFinite(uc) && uc > 0) return uc * qty;
  const mk = Number(meta.markup_percent);
  const sell = lineSell(l);
  return Number.isFinite(mk) && mk > 0 ? sell / (1 + mk / 100) : 0;
}

/**
 * Old quotes saved a kit as N separate lines (copper, insulation, tape…).
 * On load, replace each set that EXACTLY covers a live bundle's non-optional
 * component codes with ONE synthetic is_bundle line (metadata.kit) so the
 * normal kitFromSavedItem path renders a single collapsed kit.
 *
 * Price lock: unit_price = sum of the matched lines' saved totals, so the
 * area total never changes. Only collapses when unambiguous: ≥2 components,
 * every code present exactly once, and all length-bearing lines share one
 * length. Anything else is left untouched.
 */
export function collapseExplodedKits<T extends SavedLineLike>(lines: T[], bundles: BundleForCollapse[]): T[] {
  let remaining = [...lines];
  const out: T[] = [];
  for (const b of bundles) {
    const req = (b.items || []).filter((i) => !i.is_optional && (i.product || i.supplier_product));
    const codes = req.map((i) => norm((i.product || i.supplier_product)!.product_code));
    if (codes.length < 2 || codes.some((c) => !c) || new Set(codes).size !== codes.length) continue;
    const pool = remaining.filter((l) => !l.is_bundle);
    const matched: T[] = [];
    let ok = true;
    for (const c of codes) {
      const hits = pool.filter((l) => norm(l.item_number) === c);
      if (hits.length !== 1) { ok = false; break; }
      matched.push(hits[0]);
    }
    if (!ok) continue;
    const lengths = [...new Set(matched.map((l) => Number(l.length) || 0).filter((n) => n > 0))];
    if (lengths.length > 1) continue;
    const sharedLength = lengths[0] || 1;
    const sell = matched.reduce((s, l) => s + lineSell(l), 0);
    const cost = matched.reduce((s, l) => s + lineCost(l), 0);
    const first = matched[0];
    const kitLine = {
      ...first,
      is_bundle: true,
      length: sharedLength,
      quantity: 1,
      unit_price: sell,
      total_price: sell,
      metadata: {
        ...(first.metadata || {}),
        kit: {
          name: b.name,
          bundle_id: b.id,
          pricing_type: "p/meter",
          unit_cost: cost / sharedLength,
          items: req.map((i) => {
            const p = (i.product || i.supplier_product)!;
            return { name: p.short_name || p.product_code || "Item", code: p.product_code || null, quantity: i.quantity || 1, isLengthItem: !!i.is_length_item };
          }),
        },
      },
    } as T;
    const ids = new Set(matched.map((l) => l.id));
    remaining = remaining.filter((l) => !ids.has(l.id));
    out.push(kitLine);
  }
  return [...remaining, ...out];
}
