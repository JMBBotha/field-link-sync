/**
 * Auto-catalog utility: detects unmatched priced items from PDF text extraction
 * and inserts them into supplier_products automatically.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ExtractedProductRegion } from "./pdfTextExtractor";

/**
 * Extract a likely product/model code from text.
 * Looks for alphanumeric strings that resemble HVAC model codes.
 */
function extractSku(text: string): string {
  // Match patterns like FBA35A9, AZAS71MV1, RZASG100MV1, AR09TXHQA, etc.
  const skuMatch = text.match(/\b([A-Z]{2,}[\d]{1,}[A-Z0-9]*(?:[-/][A-Z0-9]+)?)\b/i);
  if (skuMatch && skuMatch[1].length >= 5) {
    return skuMatch[1].toUpperCase();
  }
  // Fallback: first word-like token with mixed letters and digits
  const fallback = text.match(/\b([A-Z0-9]{5,})\b/i);
  return fallback ? fallback[1].toUpperCase() : "";
}

/**
 * Strip price text from a label to get a cleaner description.
 */
function stripPrice(text: string): string {
  return text
    .replace(/R\s?[\d,]+(?:\.\d{1,2})?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Resolve a supplier text name (from supplier_pdf_pages) to a UUID.
 * Caches results to avoid repeated lookups.
 */
const supplierIdCache = new Map<string, string | null>();

async function resolveSupplierUuid(supplierText: string): Promise<string | null> {
  if (supplierIdCache.has(supplierText)) {
    return supplierIdCache.get(supplierText)!;
  }

  // Try direct UUID match first
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(supplierText)) {
    supplierIdCache.set(supplierText, supplierText);
    return supplierText;
  }

  // Look up by name
  const { data } = await supabase
    .from("suppliers")
    .select("id")
    .ilike("name", `%${supplierText.trim()}%`)
    .limit(1);

  const uuid = data?.[0]?.id || null;
  supplierIdCache.set(supplierText, uuid);
  return uuid;
}

interface AutoCatalogResult {
  insertedCount: number;
  newProducts: Array<{
    id: string;
    product_code: string;
    short_name: string;
    description: string;
    cost_excl_vat: number;
    supplier_id: string;
    brand: string;
  }>;
}

/**
 * Auto-catalog unmatched regions that have detected prices.
 * Inserts them into supplier_products and returns the newly created products.
 */
export async function autoCatalogFromRegions(
  regions: ExtractedProductRegion[],
  supplierText: string,
  pageHeading?: string
): Promise<AutoCatalogResult> {
  const empty: AutoCatalogResult = { insertedCount: 0, newProducts: [] };

  // Filter to unmatched regions with prices AND identifiable model codes
  const unmatched = regions.filter(r => {
    if (r.matched || !r.has_price || !r.detected_price) return false;
    // Must have a model code (alphanumeric 5+ chars with letters and digits)
    const codeMatch = r.label.match(/\b([A-Z0-9]{5,}(?:[-/][A-Z0-9]+)*)\b/i);
    if (!codeMatch) return false;
    const code = codeMatch[1];
    return /[A-Za-z]/.test(code) && /\d/.test(code);
  });
  if (unmatched.length === 0) return empty;

  // Resolve supplier UUID
  const supplierUuid = await resolveSupplierUuid(supplierText);
  if (!supplierUuid) {
    console.warn(`[autoCatalog] Could not resolve supplier UUID for "${supplierText}"`);
    return empty;
  }

  // Extract brand from supplier name
  const brand = supplierText.trim().replace(/\s+$/, "");

  // Build candidate products
  const candidates: Array<{
    sku: string;
    description: string;
    shortName: string;
    price: number;
    label: string;
  }> = [];

  for (const r of unmatched) {
    const sku = extractSku(r.label);
    if (!sku || sku.length < 3) continue; // Skip regions without identifiable SKU

    const description = stripPrice(r.label);
    const shortName = description.length > 60 ? description.substring(0, 60) : description;
    const price = r.detected_price!;

    // Deduplicate within this batch
    if (candidates.some(c => c.sku === sku)) continue;

    candidates.push({ sku, description, shortName, price, label: r.label });
  }

  if (candidates.length === 0) return empty;

  // Check which SKUs already exist for this supplier
  const skus = candidates.map(c => c.sku.toLowerCase());
  const { data: existing } = await (supabase.from("supplier_products") as any)
    .select("product_code")
    .eq("supplier_id", supplierUuid)
    .or(`archived.is.null,archived.eq.false`);

  const existingCodes = new Set(
    (existing || []).map((p: any) => (p.product_code || "").toLowerCase())
  );

  // Filter out already-existing products
  const toInsert = candidates.filter(c => !existingCodes.has(c.sku.toLowerCase()));
  if (toInsert.length === 0) return empty;

  // Determine category from heading or default
  const category = pageHeading
    ? pageHeading
        .replace(/^R-?\d+\s*/i, "") // strip refrigerant prefix
        .replace(/series/i, "")
        .trim() || "Uncategorized"
    : "Uncategorized";

  // Batch insert (50 at a time)
  const allNew: AutoCatalogResult["newProducts"] = [];
  const batchSize = 50;

  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize).map(c => ({
      supplier_id: supplierUuid,
      product_code: c.sku,
      short_name: c.shortName,
      description: c.description,
      cost_price: c.price,
      cost_excl_vat: c.price,
      cost_incl_vat: Math.round(c.price * 1.15 * 100) / 100,
      brand,
      product_category: category,
      category,
      is_active: true,
      archived: false,
    }));

    const { data: inserted, error } = await (supabase.from("supplier_products") as any)
      .insert(batch)
      .select("id, product_code, short_name, description, cost_excl_vat, supplier_id, brand");

    if (error) {
      console.error(`[autoCatalog] Insert batch failed:`, error.message);
      continue;
    }

    if (inserted) {
      allNew.push(...inserted);
    }
  }

  console.log(`[autoCatalog] Inserted ${allNew.length} new products for ${brand}`);
  return { insertedCount: allNew.length, newProducts: allNew };
}
