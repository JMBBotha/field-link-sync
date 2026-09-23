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
  quantity?: number | null;
  length?: number | null;
  supplier?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function stubProductFromQuoteItem(it: SavedQuoteItemLike): PaletteProduct {
  const meta = (it.metadata || {}) as Record<string, unknown>;
  const markup = Number(meta.markup_percent);
  const hasMarkup = Number.isFinite(markup) && markup > 0;
  // unit_cost (ours) or cost_excl (written by an interim Lovable build)
  const savedUnitCost = Number(meta.unit_cost ?? meta.cost_excl);
  const unitPrice = Number(it.unit_price) || 0;
  // Cost per saved unit: stored unit_cost, else (pre-fix rows) back it out of
  // sell ÷ (1 + markup) so old quotes keep their real margin instead of 0%.
  const unitCost =
    Number.isFinite(savedUnitCost) && savedUnitCost > 0
      ? savedUnitCost
      : hasMarkup && unitPrice > 0
        ? unitPrice / (1 + markup / 100)
        : null;
  // Length lines price off LENGTH, not quantity, but unit_price was saved as
  // total ÷ quantity — lock the whole-line value so qty ≠ 1 can't shrink it.
  const isLength = !!it.length && it.length > 0;
  const qty = isLength ? Number(it.quantity) || 1 : 1;
  const lockedSell = unitPrice * qty;
  const lockedCost = unitCost != null ? unitCost * qty : null;
  return {
    id: it.product_id || it.id,
    product_code: it.item_number || "",
    short_name: it.item_name || "",
    brand: "",
    product_category: it.item_type || "",
    category: it.item_type || "",
    description: it.description || "",
    cost_price: lockedCost ?? lockedSell,
    cost_excl_vat: lockedCost ?? lockedSell,
    cost_incl_vat: 0,
    selling_price: lockedSell,
    locked_sell_ex_vat: lockedSell,
    locked_cost_ex_vat: lockedCost,
    supplier_name: it.supplier || "",
    supplier_type: "both",
    supplier_discount_percent: null,
    markup_percent: hasMarkup ? markup : 0,
    default_markup_percent: hasMarkup ? markup : 0,
    is_pinned: false,
    pin_order: null,
    // Per-METRE rate (was the whole-line price, so raw readers doubled it).
    price_per_metre: isLength ? lockedSell / (it.length as number) : null,
    sold_in_length: isLength,
    unit_length: it.length || null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
  } as unknown as PaletteProduct;
}
