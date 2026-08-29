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
    .replace(/R\s*[\d\s,]+(?:[.,]\d{1,2})?/gi, "")
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
  // Use relaxed price regex matching SA formats (with or without decimals, comma or dot)
  const priceRegex = /R\s*[\d\s,]+(?:[.,]\d{1,2})?/g;
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

  if (unmatched.length === 0) {
    console.log(`[autoCatalog] No unmatched regions to process (style: ${isConsumableStyle ? "consumable" : "hvac"}, total regions: ${regions.length}, priced: ${pricedRows.length})`);
    return empty;
  }

  console.log(`[autoCatalog] ${unmatched.length} unmatched regions to process (style: ${isConsumableStyle ? "consumable" : "hvac"})`);

  // Resolve supplier UUID
  const supplierUuid = await resolveSupplierUuid(supplierText);
  if (!supplierUuid) {
    console.warn(`[autoCatalog] Could not resolve supplier UUID for "${supplierText}"`);
    return empty;
  }
  console.log(`[autoCatalog] Resolved supplier UUID: ${supplierUuid} from "${supplierText}"`);

  // Extract brand from supplier name
  const brand = supplierText.trim().replace(/\s+$/, "");

  // Look up discount and markup from the suppliers table
  let supplierDiscountPercent = 0;
  let supplierMarkupPercent = 35; // default 35%
  const { data: supplierData } = await (supabase.from("suppliers") as any)
    .select("supplier_discount_percent, default_trade_discount, default_markup_percent")
    .eq("id", supplierUuid)
    .limit(1);
  if (supplierData && supplierData.length > 0) {
    const row = supplierData[0];
    const discount = row.supplier_discount_percent ?? row.default_trade_discount ?? 0;
    if (discount != null) {
      supplierDiscountPercent = Number(discount) || 0;
    }
    if (row.default_markup_percent != null) {
      supplierMarkupPercent = row.default_markup_percent;
    }
  }
  console.log(`[autoCatalog] Supplier discount for "${brand}": ${supplierDiscountPercent}%, markup: ${supplierMarkupPercent}%`);

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

  if (candidates.length === 0) {
    console.log(`[autoCatalog] No candidates after SKU extraction`);
    return empty;
  }
  console.log(`[autoCatalog] ${candidates.length} candidates extracted. First 5:`, candidates.slice(0, 5).map(c => `${c.sku} @ R${c.price}`));

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
  console.log(`[autoCatalog] ${existingCodes.size} existing codes in DB, ${candidates.length - toInsert.length} candidates already exist, ${toInsert.length} new to insert`);
  if (toInsert.length > 0) {
    console.log(`[autoCatalog] First 5 to insert:`, toInsert.slice(0, 5).map(c => `${c.sku} @ R${c.price}`));
  }
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
    const batch = toInsert.slice(i, i + batchSize).map(c => {
      const rawExclVat = c.price;
      // cost_price = discounted buy price (discount applied if supplier toggle is on)
      const costPrice = Math.round(rawExclVat * (1 - supplierDiscountPercent / 100) * 100) / 100;
      const markupPct = supplierMarkupPercent;
      return {
        supplier_id: supplierUuid,
        product_code: c.sku,
        short_name: c.shortName,
        description: c.description,
        cost_price: costPrice,
        cost_excl_vat: costPrice,
        
        default_markup_percent: markupPct,
        supplier_discount_percent: supplierDiscountPercent,
        brand,
        product_category: productCategory,
        category: productCategory,
        is_active: true,
        archived: false,
      };
    });

    // Use INSERT only — no upsert/merge to prevent stale data carrying over
    const { data: inserted, error } = await (supabase.from("supplier_products") as any)
      .insert(batch)
      .select("id, product_code, short_name, description, cost_excl_vat, supplier_id, brand");

    if (error) {
      console.error(`[autoCatalog] Insert batch failed:`, error.message, error.details, error.hint);
      continue;
    }

    console.log(`[autoCatalog] Batch insert returned ${inserted?.length ?? 0} rows`);

    if (inserted) {
      allNew.push(...inserted);
    }
  }

  console.log(`[autoCatalog] Inserted ${allNew.length} new products for ${brand} (style: ${isConsumableStyle ? "consumable" : "hvac"})`);
  return { insertedCount: allNew.length, newProducts: allNew };
}
