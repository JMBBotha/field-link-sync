/**
 * Shared converter: a product selected off a supplier PDF page → PaletteProduct,
 * so PDF selections can be dropped into the SAME baskets the Build and Area
 * tabs use (single source of truth for the quote).
 *
 * The real catalog UUID is used whenever the PDF row matched a live catalog
 * product — only rows with no catalog match fall back to a synthetic id.
 * Cost is never invented from a printed list price.
 */
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import type { PdfSelectedProduct } from "@/types/pdfSelection";

export function pdfItemToPaletteProduct(item: PdfSelectedProduct): PaletteProduct {
  const price = parseFloat(item.price) || 0;
  const cost = item.costPrice != null ? Number(item.costPrice) : price;
  const markup = item.markupPercent != null ? Number(item.markupPercent) : 35;
  return {
    id: item.productId || `pdf-${item.code}`,
    product_code: item.productCode || item.code,
    short_name: item.description || item.productCode || item.code,
    brand: "",
    product_category: "",
    category: "",
    cost_excl_vat: cost,
    cost_incl_vat: price,
    cost_price: cost,
    selling_price: price,
    default_markup_percent: markup,
    description: item.pdfDescription || item.description || item.code,
    is_pinned: false,
    pin_order: null,
    supplier_name: item.supplierName || "",
    supplier_type: "",
    price_per_metre: null,
    sold_in_length: false,
    unit_length: null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
    supplier_discount_percent: null,
    markup_percent: markup,
  } as PaletteProduct;
}
