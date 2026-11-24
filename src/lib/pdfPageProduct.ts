import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import { resolveProductMarkupPercent } from "@/lib/pricing";

/**
 * A row the page-scoped live_supplier_products query already returned.
 * That view is the live book, so the row is quotable even when the
 * in-memory palette was truncated before it.
 */
export interface PageLiveProductRow {
  id?: string | null;
  product_code?: string | null;
  short_name?: string | null;
  description?: string | null;
  brand?: string | null;
  product_category?: string | null;
  category?: string | null;
  cost_excl_vat?: number | null;
  cost_incl_vat?: number | null;
  cost_price?: number | null;
  selling_price?: number | null;
  default_markup_percent?: number | null;
  markup_percent?: number | null;
  supplier_discount_percent?: number | null;
}

/** Palette copy when we have one; otherwise the live page row itself. */
export function productForPageRegion(
  pageRow: PageLiveProductRow | null | undefined,
  paletteMatch: PaletteProduct | null | undefined,
): PaletteProduct | null {
  if (paletteMatch) return paletteMatch;
  if (!pageRow?.id) return null;
  return paletteProductFromPageRow(pageRow);
}

export function paletteProductFromPageRow(row: PageLiveProductRow): PaletteProduct {
  const cost = Number(row.cost_excl_vat ?? row.cost_price ?? 0) || 0;
  const markup = resolveProductMarkupPercent(row);
  return {
    id: row.id as string,
    product_code: row.product_code || "",
    short_name: row.short_name || row.description || row.product_code || "",
    brand: row.brand || "",
    product_category: row.product_category || row.category || "",
    category: row.category || row.product_category || "",
    cost_excl_vat: cost,
    cost_incl_vat: Number(row.cost_incl_vat ?? 0) || 0,
    cost_price: Number(row.cost_price ?? row.cost_excl_vat ?? 0) || 0,
    selling_price: Number(row.selling_price ?? 0) || 0,
    default_markup_percent: markup,
    description: row.description || row.short_name || row.product_code || "",
    is_pinned: false,
    pin_order: null,
    supplier_name: row.brand || "",
    supplier_type: "both",
    price_per_metre: null,
    sold_in_length: false,
    unit_length: null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
    supplier_discount_percent: row.supplier_discount_percent ?? null,
    markup_percent: row.markup_percent ?? null,
  };
}
