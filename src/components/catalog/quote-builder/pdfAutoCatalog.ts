/**
 * Auto-catalog utility: detects unmatched priced items from PDF text extraction
 * and inserts them into supplier_products automatically.
 *
 * Supports two modes:
 *   - HVAC (strict): requires model codes + 2 prices
 *   - Consumable (relaxed): any row with a detected price gets inserted
 */
import { supabase } from "@/integrations/supabase/client";
import type { ExtractedProductRegion } from "./pdfTextExtractor";

/**
 * Extract a likely product/model code from text.
 * Looks for alphanumeric strings that resemble item codes.
 */
function extractSku(text: string): string {
  // Match patterns like FBA35A9, ALU001, BRAC01, AR09TXHQA, etc.
  const skuMatch = text.match(/\b([A-Z]{2,}[\d]{1,}[A-Z0-9]*(?:[-/][A-Z0-9]+)?)\b/i);
  if (skuMatch && skuMatch[1].length >= 3) {
    return skuMatch[1].toUpperCase();
  }
  // Fallback: first word-like token with mixed letters and digits
  const fallback = text.match(/\b([A-Z0-9]{3,})\b/i);
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
 *
 * For consumable-style catalogs (One Stop Shop, etc.), ALL unmatched rows
 * with a detected price are inserted — no model-code or multi-price gate.
 */
export async function autoCatalogFromRegions(
  regions: ExtractedProductRegion[],
  supplierText: string,
  pageHeading?: string
): Promise<AutoCatalogResult> {
  const empty: AutoCatalogResult = { insertedCount: 0, newProducts: [] };

  // Detect catalog style from the regions themselves:
  // If fewer than 30% of priced rows have 2+ prices, treat as consumable
  const pricedRows = regions.filter(r => r.has_price && r.detected_price);
  // Use relaxed price regex matching extractor (with or without decimals)
  const priceRegex = /R\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?/g;
  const multiPriceRows = pricedRows.filter(r => {
    const prices = r.label.match(priceRegex);
    return prices && prices.length >= 2;
  });
  const isConsumableStyle = pricedRows.length > 0 && multiPriceRows.length < pricedRows.length * 0.3;

  // Filter to unmatched regions with prices
  const unmatched = regions.filter(r => {
    if (r.matched || !r.has_price || !r.detected_price) return false;

    if (isConsumableStyle) {
      // Consumable mode: any unmatched row with a price qualifies
      // Just skip very long descriptive text
      if (r.label.length > 200) return false;
      return true;
    }

    // HVAC strict mode: require model code + 2 prices
    const modelCodeRegex = /\b[A-Z]{2,5}[A-Z0-9]{2,}\d{1,3}[A-Z0-9]*\b/;
    if (!modelCodeRegex.test(r.label)) return false;
    const prices = r.label.match(priceRegex);
    if (!prices || prices.length < 2) return false;
    if (r.label.length > 120) return false;
    return true;
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
    const price = r.detected_price!;

    // Skip very cheap items only for HVAC; consumables can be cheap
    if (!isConsumableStyle && price < 50) continue;
    if (isConsumableStyle && price < 1) continue;

    // For consumable items without a clear SKU, generate one from the label
    let finalSku = sku;
    if (!finalSku || finalSku.length < 2) {
      // Generate a deterministic code from the label
      const words = r.label.replace(/[^A-Za-z0-9\s]/g, "").trim().split(/\s+/);
      finalSku = words.slice(0, 2).join("").substring(0, 8).toUpperCase() || `ITEM${candidates.length}`;
    }

    // Skip junk: SKU is all letters with no digits AND not consumable
    if (!isConsumableStyle && /^[A-Z]+$/i.test(finalSku)) continue;

    const description = stripPrice(r.label);
    const shortName = description.length > 60 ? description.substring(0, 60) : description;

    // Deduplicate within this batch by SKU
    if (candidates.some(c => c.sku === finalSku)) {
      // If duplicate SKU, append a suffix
      finalSku = `${finalSku}-${candidates.length}`;
    }

    candidates.push({ sku: finalSku, description, shortName, price, label: r.label });
  }

  if (candidates.length === 0) return empty;

  // Check which SKUs already exist for this supplier
  // Check ALL products (including archived) to avoid unique constraint violations
  const { data: existing } = await (supabase.from("supplier_products") as any)
    .select("product_code")
    .eq("supplier_id", supplierUuid);

  const existingCodes = new Set(
    (existing || []).map((p: any) => (p.product_code || "").toLowerCase())
  );

  // Filter out already-existing products
  const toInsert = candidates.filter(c => !existingCodes.has(c.sku.toLowerCase()));
  if (toInsert.length === 0) return empty;

  // BUG 1 FIX: Always use "Consumables" for consumable-style catalogs
  const category = isConsumableStyle
    ? "Consumables"
    : pageHeading
      ? pageHeading
          .replace(/^R-?\d+\s*/i, "")
          .replace(/series/i, "")
          .trim() || "Uncategorized"
      : "Uncategorized";

  // Set product_category explicitly for consumable items
  const productCategory = isConsumableStyle ? "Consumables" : category;

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
      product_category: productCategory,
      category: productCategory,
      is_active: true,
      archived: false,
    }));

    // Use upsert with ignoreDuplicates to gracefully handle any remaining conflicts
    const { data: inserted, error } = await (supabase.from("supplier_products") as any)
      .upsert(batch, { onConflict: "supplier_id,product_code", ignoreDuplicates: true })
      .select("id, product_code, short_name, description, cost_excl_vat, supplier_id, brand");

    if (error) {
      console.error(`[autoCatalog] Upsert batch failed:`, error.message);
      continue;
    }

    if (inserted) {
      allNew.push(...inserted);
    }
  }

  console.log(`[autoCatalog] Inserted ${allNew.length} new products for ${brand} (style: ${isConsumableStyle ? "consumable" : "hvac"})`);
  return { insertedCount: allNew.length, newProducts: allNew };
}
