import type { PaletteProduct } from "../QuoteBuilderTab";

/**
 * Returns the display name for a product, stripping duplicate brand prefix.
 * If the product name (short_name) already starts with the brand, don't prepend brand again.
 */
export function getProductDisplayName(product: PaletteProduct): string {
  const name = product.short_name || product.product_code || "";
  const brand = (product.brand || "").trim();

  if (!brand) return name;

  // If name already starts with brand (case-insensitive), just use the name as-is
  if (name.toLowerCase().startsWith(brand.toLowerCase())) {
    return name;
  }

  // Otherwise prepend brand
  return `${brand} ${name}`;
}

/**
 * Builds a searchable blob from all relevant product fields.
 */
export function buildProductSearchBlob(product: PaletteProduct): string {
  return [
    product.product_code,
    product.short_name,
    product.brand,
    product.description,
    product.category,
    product.product_category,
    product.supplier_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
