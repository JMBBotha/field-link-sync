/**
 * Turn a SAVED quote_item back into a builder product.
 *
 * INVARIANT (do not break — this bug has regressed several times):
 *   quote_items.unit_price is the FINAL selling price, ex VAT. Markup was
 *   applied exactly once, when the line was first added. Re-opening a quote
 *   must reproduce that price exactly — never cost × (1 + markup) again.
 *
 * Previously the stub set cost_price = unit_price AND markup_percent = the
 * saved markup, so every open re-applied markup (Samsung: ×1.25; rows with 0
 * markup fell back to ×1.35) and auto-save wrote the inflated price back.
 * The locked_sell_ex_vat field makes every pricing helper return the saved
 * price verbatim. Covered by src/test/quotePriceLock.test.ts.
 */
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

export interface SavedQuoteItemLike {
  id: string;
  product_id?: string | null;
  item_number?: string | null;
  item_name?: string | null;
  item_type?: string | null;
  description?: string | null;
  unit_price?: number | null;
  length?: number | null;
  supplier?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function stubProductFromQuoteItem(it: SavedQuoteItemLike): PaletteProduct {
  const meta = (it.metadata || {}) as Record<string, unknown>;
  const markup = Number(meta.markup_percent);
  const unitCost = Number(meta.unit_cost);
  const unitPrice = Number(it.unit_price) || 0;
  return {
    id: it.product_id || it.id,
    product_code: it.item_number || "",
    short_name: it.item_name || "",
    brand: "",
    product_category: it.item_type || "",
    category: it.item_type || "",
    description: it.description || "",
    cost_price: Number.isFinite(unitCost) && unitCost > 0 ? unitCost : unitPrice,
    cost_excl_vat: Number.isFinite(unitCost) && unitCost > 0 ? unitCost : unitPrice,
    cost_incl_vat: 0,
    selling_price: unitPrice,
    locked_sell_ex_vat: unitPrice,
    locked_cost_ex_vat: Number.isFinite(unitCost) && unitCost > 0 ? unitCost : null,
    supplier_name: it.supplier || "",
    supplier_type: "both",
    supplier_discount_percent: null,
    markup_percent: Number.isFinite(markup) && markup > 0 ? markup : 0,
    default_markup_percent: Number.isFinite(markup) && markup > 0 ? markup : 0,
    is_pinned: false,
    pin_order: null,
    price_per_metre: it.length ? unitPrice : null,
    sold_in_length: !!it.length,
    unit_length: it.length || null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
  } as unknown as PaletteProduct;
}
