/**
 * Shared converter: a product selected off a supplier PDF page → PaletteProduct,
 * so PDF selections can be dropped into the SAME baskets the Build and Area
 * tabs use (single source of truth for the quote).
 */
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import type { PdfSelectedProduct } from "@/types/pdfSelection";

export function pdfItemToPaletteProduct(item: PdfSelectedProduct): PaletteProduct {
  const price = parseFloat(item.price) || 0;
  return {
    id: `pdf-${item.code}`,
    product_code: item.code,
    short_name: item.description || item.code,
    brand: "",
    product_category: "",
    category: "",
    cost_excl_vat: item.costPrice ?? price,
    cost_incl_vat: price,
    cost_price: item.costPrice ?? price,
    selling_price: price,
    default_markup_percent: item.markupPercent ?? 0.35,
    description: item.description || item.code,
    is_pinned: false,
    pin_order: null,
    supplier_name: "",
    supplier_type: "",
    price_per_metre: null,
    sold_in_length: false,
    unit_length: null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
    supplier_discount_percent: null,
    markup_percent: item.markupPercent ?? 0.35,
  } as PaletteProduct;
}
