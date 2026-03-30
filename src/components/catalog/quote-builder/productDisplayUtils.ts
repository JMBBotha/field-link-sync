import type { PaletteProduct } from "../QuoteBuilderTab";

/**
 * Clean a description that may be duplicated with " - " separator.
 * e.g. "Knock in Nails 6mm x 35mm (Box 100) - Knock in Nails 6mm x 35mm (Box 100)" → "Knock in Nails 6mm x 35mm (Box 100)"
 */
function cleanDescription(desc: string): string {
  if (!desc) return "";
  const parts = desc.split(" - ");
  if (parts.length >= 2 && parts[0].trim().toLowerCase() === parts[1].trim().toLowerCase()) {
    return parts[0].trim();
  }
  return desc.trim();
}

/**
 * Returns the display name for a product, stripping duplicate brand prefix.
 * For materials where short_name is null or equals product_code, uses description instead.
 */
export function getProductDisplayName(product: PaletteProduct): string {
  const code = product.product_code || "";
  const shortName = (product.short_name || "").trim();
  const desc = cleanDescription(product.description || "");

  // If short_name is empty or same as product_code, prefer cleaned description
  if (!shortName || shortName.toLowerCase() === code.toLowerCase()) {
    if (desc && desc.toLowerCase() !== code.toLowerCase()) {
      return desc;
    }
    return code;
  }

  const brand = (product.brand || "").trim();
  if (!brand) return shortName;

  // If name already starts with brand (case-insensitive), just use the name as-is
  if (shortName.toLowerCase().startsWith(brand.toLowerCase())) {
    return shortName;
  }

  return `${brand} ${shortName}`;
}

/**
 * Returns a brief description line for the palette card (max ~50 chars).
 * Falls back through description → product_code.
 */
export function getProductBriefDescription(product: PaletteProduct): string | null {
  const code = product.product_code || "";
  const desc = cleanDescription(product.description || "");
  const displayName = getProductDisplayName(product);

  // If description is different from the display name, show it
  if (desc && desc.toLowerCase() !== displayName.toLowerCase() && desc.toLowerCase() !== code.toLowerCase()) {
    return desc.length > 50 ? desc.slice(0, 47) + "..." : desc;
  }
  return null;
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
