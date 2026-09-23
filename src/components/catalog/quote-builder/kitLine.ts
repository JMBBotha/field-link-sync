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

export const DEFAULT_KIT_LENGTH_M = 1;

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
