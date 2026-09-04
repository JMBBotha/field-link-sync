/**
 * DIFF IMPORT PIPELINE — safe, non-destructive supplier product import.
 *
 * Extracted from `src/components/catalog/SupplierProductImporter.tsx` so the same
 * safe behavior can be reused by every import entry point (not just the catalog
 * admin page). Matches incoming rows to existing `supplier_products` by
 * `product_code`, classifies each as new / update / restore / archive, and never
 * hard-deletes: products missing from a new price list are archived (soft-deleted),
 * not destroyed. This replaces the old `runImportPipeline` (`pdfImportPipeline.ts`)
 * which purged (hard-deleted, cascading through quote_items/job_used_parts/
 * inventory_stock/bundle_items) ALL of a supplier's products on every import.
 *
 * See docs/pricing-and-import-architecture-findings.md for the full investigation.
 */

import { supabase } from "@/integrations/supabase/client";

/** Strip non-numeric chars, e.g. AI-parsed "9000 BTU" → 9000 */
function sanitizeInt(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return isNaN(val) ? null : Math.round(val);
  const n = parseInt(String(val).replace(/[^0-9\-]/g, ""), 10);
  return isNaN(n) ? null : n;
}

/** Common shape every import source (AI parse, CSV, admin form) can map into. */
export interface DiffImportRow {
  product_code: string;
  description: string;
  category: string;
  /** Buy price excl VAT, after trade discount is already applied (the override cost). */
  cost_price: number;
  pipe_size?: string | null;
  btu_rating?: number | null;
  refrigerant_type?: string | null;
  is_price_on_request?: boolean;
  short_name?: string | null;
  product_type?: string;
  sold_in_length?: boolean;
  unit_length?: number | null;
  unit_length_unit?: string;
  price_per_metre?: number | null;
  min_cut_length?: number;
  brand?: string | null;
  product_category?: string;
  /** Optional explicit VAT/discount columns, if the source already computed them. */
  cost_excl_vat?: number | null;
  cost_incl_vat?: number | null;
  supplier_discount_percent?: number;
  vat_rate?: number;
}

export type DiffAction = "new" | "update" | "archive" | "unchanged" | "restore";

export interface DiffRow extends DiffImportRow {
  action: DiffAction;
  old_cost_price?: number;
  existing_id?: string;
}

/**
 * Build a diff between incoming rows and the supplier's existing catalog
 * (including already-archived products, so re-appearing codes are "restored"
 * instead of duplicated). Products present in the catalog but absent from
 * `incoming` are classified "archive" — never "delete".
 *
 * BRAND SCOPE (catalog SoT lock): archiving is restricted to the brands the
 * incoming file actually covers. A new Samsung book therefore never archives
 * Alliance/Midea rows sitting under the same supplier. When the incoming rows
 * carry no brand at all, nothing is archived.
 */
export async function buildProductDiff(
  supplierId: string,
  incoming: DiffImportRow[]
): Promise<DiffRow[]> {
  const { data: existing, error: fetchErr } = await supabase
    .from("supplier_products" as any)
    .select("id, product_code, cost_price, archived, description, brand, product_category, category")
    .eq("supplier_id", supplierId)
    .limit(5000);


  if (fetchErr) {
    console.error("[DiffImport] Failed to fetch existing products for diff:", fetchErr);
  }

  const existingMap = new Map<
    string,
    { id: string; cost_price: number; archived: boolean; description: string; brand: string | null; product_category: string | null; category: string | null }
  >();
  (existing || []).forEach((e: any) => {
    existingMap.set((e.product_code || "").toUpperCase(), {
      id: e.id,
      cost_price: e.cost_price || 0,
      archived: !!e.archived,
      description: e.description || "",
      brand: e.brand || null,
      product_category: e.product_category || null,
      category: e.category || null,
    });
  });

  // ---------- Sanitize & dedupe incoming rows before diffing ----------
  // A supplier file can legitimately contain a duplicate SKU (two rows for
  // the same product_code, e.g. from a merged multi-page PDF parse) or a
  // row with a missing/garbage cost_price (bad AI parse, blank cell). Either
  // one silently corrupts the diff — duplicates make "new" vs "update"
  // ambiguous, and a NaN/negative cost would get inserted or would archive
  // a perfectly good existing product by never matching. Both are dropped
  // here (last occurrence of a duplicate code wins) with a console warning
  // so the import can proceed safely instead of failing or corrupting data.
  const seenCodes = new Set<string>();
  const cleanIncoming: DiffImportRow[] = [];
  for (let i = incoming.length - 1; i >= 0; i--) {
    const row = incoming[i];
    const code = (row.product_code || "").trim().toUpperCase();
    if (!code) {
      console.warn("[DiffImport] Skipping row with empty product_code", row);
      continue;
    }
    if (seenCodes.has(code)) {
      console.warn(`[DiffImport] Duplicate product_code "${code}" in incoming file — keeping the last occurrence, dropping the rest`);
      continue;
    }
    const cost = Number(row.cost_price);
    if (!Number.isFinite(cost) || cost < 0) {
      console.warn(`[DiffImport] Skipping row "${code}" with invalid cost_price:`, row.cost_price);
      continue;
    }
    seenCodes.add(code);
    cleanIncoming.unshift({ ...row, product_code: code, cost_price: cost });
  }

  const incomingCodes = new Set(cleanIncoming.map((r) => r.product_code.toUpperCase()));
  const diff: DiffRow[] = [];

  for (const row of cleanIncoming) {
    const key = row.product_code.toUpperCase();
    const match = existingMap.get(key);
    if (match) {
      if (match.archived) {
        diff.push({ ...row, action: "restore", old_cost_price: match.cost_price, existing_id: match.id });
        continue;
      }
      const priceChanged = Math.abs(match.cost_price - row.cost_price) > 0.01;
      const descChanged = !!row.description && row.description !== match.description;
      const brandChanged = !!row.brand && row.brand !== match.brand;
      const catChanged = !!row.product_category && row.product_category !== (match.product_category || match.category);
      const hasChanges = priceChanged || descChanged || brandChanged || catChanged;
      diff.push({ ...row, action: hasChanges ? "update" : "unchanged", old_cost_price: match.cost_price, existing_id: match.id });
    } else {
      diff.push({ ...row, action: "new" });
    }
  }

  // Brands actually covered by this file — anything else stays untouched.
  const incomingBrands = new Set(
    cleanIncoming.map((r) => (r.brand || "").trim().toLowerCase()).filter(Boolean),
  );

  for (const [code, data] of existingMap) {
    if (incomingCodes.has(code) || data.archived) continue;
    const existingBrand = (data.brand || "").trim().toLowerCase();
    // No brand on the incoming file, or a different brand on the existing row →
    // never archive. Only same-brand SKUs dropped from the new book are archived.
    if (incomingBrands.size === 0 || !existingBrand || !incomingBrands.has(existingBrand)) continue;
    diff.push({
      product_code: code,
      description: "(existing product not in new list)",
      category: "",
      cost_price: data.cost_price,
      pipe_size: null,
      btu_rating: null,
      refrigerant_type: null,
      is_price_on_request: false,
      short_name: null,
      brand: data.brand,
      action: "archive",
      existing_id: data.id,
      old_cost_price: data.cost_price,
    });
  }


  return diff;
}

export interface ApplyDiffOptions {
  supplierId: string;
  supplierName: string;
  diffRows: DiffRow[];
  /** Convert all "unchanged" rows into "update" so they get refreshed too. */
  forceAll?: boolean;
  isConsumablesSupplier?: boolean;
  defaultMarkupPercent?: number;
  /** File name recorded in the price_list_uploads audit row. */
  fileName?: string | null;
  onProgress?: (pct: number) => void;
  /**
   * Whether the incoming file represents the supplier's ENTIRE current
   * catalogue (default true). When true, any active product missing from
   * the file is archived (soft-deleted) — the normal, safe behavior for a
   * full price-list replacement. When false (a partial/delta file — e.g. a
   * "price changes only" sheet or a promo update covering a handful of
   * SKUs), the archive step is skipped entirely so products simply absent
   * from this smaller file are left untouched instead of being wrongly
   * archived.
   */
  isFullCatalogue?: boolean;
}

export interface ApplyDiffResult {
  imported: number;
  updated: number;
  archived: number;
  /** Rows matched with no changes (reported in the post-parse summary). */
  unchanged: number;
  errors: number;
  firstError: string;
}

/**
 * Apply a diff produced by `buildProductDiff`: inserts new rows, updates
 * changed/restored rows, and archives (soft-deletes) rows no longer present.
 * Archiving is skipped if any insert/update failed, so a partial failure never
 * silently hides products that just haven't been successfully re-imported yet.
 */
export async function applyProductDiff(opts: ApplyDiffOptions): Promise<ApplyDiffResult> {
  const {
    supplierId,
    supplierName,
    diffRows,
    forceAll = false,
    isConsumablesSupplier = false,
    defaultMarkupPercent = 30,
    fileName = null,
    onProgress,
    isFullCatalogue = true,
  } = opts;

  const workingRows = forceAll
    ? diffRows.map((r) => (r.action === "unchanged" ? { ...r, action: "update" as DiffAction } : r))
    : diffRows;

  const newRows = workingRows.filter((r) => r.action === "new");
  const updateRows = workingRows.filter((r) => r.action === "update" || r.action === "restore");
  // Delta/partial files never archive — a product just not being in a small
  // "price changes only" file is not evidence it was discontinued.
  const archiveRows = isFullCatalogue ? workingRows.filter((r) => r.action === "archive") : [];
  const unchanged = workingRows.filter((r) => r.action === "unchanged").length;
  const total = newRows.length + updateRows.length + archiveRows.length;

  let imported = 0, updated = 0, archived = 0, errors = 0;
  let firstError = "";
  let processed = 0;
  const tick = () => {
    processed++;
    onProgress?.(total > 0 ? Math.round((processed / total) * 100) : 100);
  };

  if (total === 0) {
    return { imported: 0, updated: 0, archived: 0, unchanged, errors: 0, firstError: "" };
  }

  console.log(`[DiffImport] Starting import for supplier "${supplierName}" (id: ${supplierId}), ${newRows.length} new, ${updateRows.length} updates, ${archiveRows.length} archives`);

  // ── PHASE 1: INSERT new products (batched) ──
  const BATCH = 50;
  for (let b = 0; b < newRows.length; b += BATCH) {
    const batch = newRows.slice(b, b + BATCH);
    const batchData = batch.map((row) => ({
      supplier_id: supplierId,
      product_code: row.product_code,
      description: row.description,
      category: row.category || "General",
      cost_price: row.cost_price,
      pipe_size: row.pipe_size,
      btu_rating: sanitizeInt(row.btu_rating),
      refrigerant_type: row.refrigerant_type,
      is_price_on_request: row.is_price_on_request,
      default_markup_percent: defaultMarkupPercent,
      is_active: true,
      archived: false,
      short_name: row.short_name,
      product_type: row.product_type || (isConsumablesSupplier ? "consumable" : "ac_unit"),
      product_category: row.product_category || (isConsumablesSupplier ? "Consumables" : "Air Conditioning"),
      brand: row.brand || null,
      sold_in_length: row.sold_in_length || false,
      unit_length: row.unit_length || null,
      unit_length_unit: row.unit_length_unit || "m",
      price_per_metre: row.price_per_metre || null,
      min_cut_length: row.min_cut_length || 0.5,
      cost_excl_vat: row.cost_excl_vat ?? null,
      cost_incl_vat: row.cost_incl_vat ?? null,
      supplier_discount_percent: row.supplier_discount_percent || 0,
      vat_rate: row.vat_rate || 15,
    }));

    const { error: err, data } = await (supabase.from("supplier_products" as any) as any)
      .upsert(batchData as any, { onConflict: "supplier_id,product_code" })
      .select("id");
    if (err) {
      const msg = `INSERT batch failed: ${err.message} | ${err.details || ""} | ${err.hint || ""}`;
      console.error("[DiffImport]", msg, err);
      if (!firstError) firstError = msg;
      errors += batch.length;
    } else {
      imported += (data as any[])?.length || batch.length;
    }
    for (let i = 0; i < batch.length; i++) tick();
  }

  // ── PHASE 2: UPDATE existing products (including restores) ──
  for (const row of updateRows) {
    const updateData: any = {
      cost_price: row.cost_price,
      description: row.description,
      category: row.category || "General",
      brand: row.brand || null,
      product_category: row.product_category || null,
      short_name: row.short_name,
      updated_at: new Date().toISOString(),
      archived: false,
      archived_at: null,
    };
    if (row.cost_excl_vat !== undefined) {
      updateData.cost_excl_vat = row.cost_excl_vat;
      updateData.cost_incl_vat = row.cost_incl_vat;
    }
    const { error: err } = await supabase.from("supplier_products" as any).update(updateData).eq("id", row.existing_id);
    if (err) {
      const msg = `UPDATE failed for ${row.product_code}: ${err.message}`;
      console.error("[DiffImport]", msg, err);
      if (!firstError) firstError = msg;
      errors++;
    } else {
      updated++;
    }
    tick();
  }

  // ── PHASE 3: ARCHIVE only if inserts + updates had no errors ──
  if (errors > 0 && archiveRows.length > 0) {
    console.warn(`[DiffImport] Skipping archive of ${archiveRows.length} products because ${errors} insert/update errors occurred`);
    for (let i = 0; i < archiveRows.length; i++) tick();
  } else {
    for (const row of archiveRows) {
      const { error: err } = await supabase
        .from("supplier_products" as any)
        .update({ archived: true, archived_at: new Date().toISOString() } as any)
        .eq("id", row.existing_id);
      if (err) {
        const msg = `ARCHIVE failed for ${row.product_code}: ${err.message}`;
        console.error("[DiffImport]", msg, err);
        if (!firstError) firstError = msg;
        errors++;
      } else {
        archived++;
      }
      tick();
    }
  }

  // Record import history (best-effort, non-fatal)
  try {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("price_list_uploads" as any).insert({
      supplier_id: supplierId,
      file_name: fileName || "Diff Import",
      file_type: "pdf",
      status: errors > 0 ? "partial" : "completed",
      products_imported: imported,
      products_updated: updated,
      products_skipped: errors,
      products_archived: archived,
      uploaded_by: userData?.user?.id || null,
    } as any);
  } catch (auditErr) {
    console.warn("[DiffImport] Failed to write price_list_uploads audit row (non-fatal):", auditErr);
  }

  console.log(`[DiffImport] ✅ Complete — ${imported} new, ${updated} updated, ${archived} archived, ${errors} errors`);
  return { imported, updated, archived, unchanged, errors, firstError };
}
