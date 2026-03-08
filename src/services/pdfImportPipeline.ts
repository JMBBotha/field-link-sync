/**
 * PDF IMPORT PIPELINE — Single entry point for all supplier imports.
 *
 * Orchestrates: PURGE → UPLOAD → PARSE → VALIDATE → INSERT → AUDIT
 *
 * Call `runImportPipeline()` from any UI component. It handles everything.
 */

import { supabase } from "@/integrations/supabase/client";
import { cleanImportForSupplier, logImportAction } from "@/services/cleanImportPipeline";
import { capturePdfPages } from "@/lib/pdfPageCapture";
import {
  validateProduct,
  VALIDATION_RULES,
  PRICING_RULES,
} from "@/config/pdfExtractionConfig";
import type { ParsedProduct, ImportStage } from "@/services/productImportParser";

// ─── TYPES ───

export interface PipelineOptions {
  supplierId: string;
  supplierName: string;
  /** Already-parsed products from the preview step */
  products: ParsedProduct[];
  /** The original file (for storage upload + supplier info extraction) */
  file?: File | null;
  /** Callback for stage updates */
  onStage?: (stage: ImportStage) => void;
}

export interface PipelineResult {
  success: boolean;
  productsImported: number;
  productsSkipped: number;
  pdfUploadId: string | null;
  purgedProducts: number;
  purgedPdfs: number;
  validationWarnings: string[];
  error?: string;
}

// ─── MAIN PIPELINE ───

export async function runImportPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { supplierId, supplierName, products, file } = opts;
  const warnings: string[] = [];
  let pdfUploadId: string | null = null;

  // ── STEP 1: PURGE old data ──
  console.log("[Pipeline] Step 1: Clean purge...");
  const purgeResult = await cleanImportForSupplier(supplierId);
  await logImportAction({
    supplierId,
    action: "clean_purge",
    productsDeleted: purgeResult.deletedProducts,
    pdfsDeleted: purgeResult.deletedPdfs,
  });

  // ── STEP 2: UPLOAD PDF to storage ──
  if (file && file.name.toLowerCase().endsWith(".pdf")) {
    console.log("[Pipeline] Step 2: Uploading PDF to storage...");
    const filePath = `${supplierId}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("supplier-pdfs")
      .upload(filePath, file);

    if (uploadError) {
      console.warn("[Pipeline] Storage upload failed (non-fatal):", uploadError.message);
    }

    // Create pdf_uploads record
    const { data: pdfRecord, error: pdfError } = await (supabase.from("pdf_uploads") as any)
      .insert({
        supplier_id: supplierId,
        file_name: file.name,
        file_path: filePath,
        status: "parsed",
      })
      .select()
      .single();

    if (pdfError) {
      console.warn("[Pipeline] PDF record creation failed (non-fatal):", pdfError.message);
    } else {
      pdfUploadId = pdfRecord?.id || null;
    }

    // ── STEP 2b: EXTRACT PDF pages as images for visual builder ──
    console.log("[Pipeline] Step 2b: Extracting PDF pages as images...");
    try {
      const captureResult = await capturePdfPages(file, supplierName, undefined, supplierId);
      console.log(`[Pipeline] Page capture: ${captureResult.pagesStored} stored, ${captureResult.errors} errors`);
      if (captureResult.pagesStored === 0) {
        warnings.push("PDF page image extraction failed — visual builder may not show pages");
      }
    } catch (captureErr: any) {
      console.warn("[Pipeline] PDF page capture failed (non-fatal):", captureErr.message);
      warnings.push("PDF page image extraction failed — visual builder may not show pages");
    }
  }

  // ── STEP 3: VALIDATE products ──
  console.log(`[Pipeline] Step 3: Validating ${products.length} products...`);
  const validProducts: ParsedProduct[] = [];
  let skipped = 0;

  for (const p of products) {
    const error = validateProduct({
      product_code: p.model_number,
      cost_price: p.cost_price,
      description: p.description,
    });

    if (error) {
      skipped++;
      // Auto-fix: generate code for empty/short codes
      if (error.startsWith("Product code too short")) {
        const words = (p.description || "").replace(/[^A-Za-z0-9\s]/g, "").trim().split(/\s+/);
        const derivedCode = words.slice(0, 3).join("").substring(0, 12).toUpperCase() || `AUTO-${skipped}`;
        validProducts.push({ ...p, model_number: derivedCode });
        warnings.push(`Auto-generated code "${derivedCode}" for "${p.description?.substring(0, 40)}"`);
        skipped--; // un-skip since we fixed it
        continue;
      }
      console.warn(`[Pipeline] Skipping product: ${error}`);
      continue;
    }

    // Sanity-check price range
    if (p.cost_price < VALIDATION_RULES.minPrice || p.cost_price > VALIDATION_RULES.maxPrice) {
      skipped++;
      continue;
    }

    // Non-negotiable: validate price_bbox is in rightmost column if present
    if (p.price_bbox && (p.price_bbox.x + p.price_bbox.width) < 0.7) {
      warnings.push(`price_bbox not in rightmost column for "${p.model_number}" — bbox ignored`);
      validProducts.push({ ...p, price_bbox: null });
      continue;
    }

    validProducts.push(p);
  }

  if (validProducts.length === 0) {
    return {
      success: false,
      productsImported: 0,
      productsSkipped: skipped,
      pdfUploadId,
      purgedProducts: purgeResult.deletedProducts,
      purgedPdfs: purgeResult.deletedPdfs,
      validationWarnings: warnings,
      error: "No valid products after validation",
    };
  }

  if (skipped > 0) {
    warnings.push(`${skipped} products skipped due to validation errors`);
  }

  // ── STEP 4: INSERT products ──
  console.log(`[Pipeline] Step 4: Inserting ${validProducts.length} products...`);
  const rows = validProducts.map((p) => ({
    supplier_id: supplierId,
    product_code: p.model_number || "UNKNOWN",
    short_name: p.short_name || (p.description || "").substring(0, 80),
    description: p.description || "",
    category: p.category || "Uncategorized",
    product_category: p.product_category || p.category || "Uncategorized",
    cost_price: p.cost_price,
    cost_excl_vat: p.cost_price,
    default_markup_percent: p.default_markup_percent || p.markup_percent || PRICING_RULES.defaultMarkupPercent,
    brand: p.brand || supplierName || "",
    is_active: true,
    archived: false,
    btu_rating: p.btu_rating || null,
    pipe_size: p.pipe_size || null,
    refrigerant_type: p.refrigerant_type || null,
    phase: p.phase || null,
    kw: p.kw || null,
    sold_in_length: p.sold_in_length || false,
    unit_length: p.unit_length || null,
    price_per_metre: p.price_per_metre || null,
    row_bbox: p.row_bbox || null,
    price_bbox: p.price_bbox || null,
    page_number: p.page_number || null,
    ...(pdfUploadId ? { pdf_upload_id: pdfUploadId } : {}),
  }));

  // Final filter: remove any rows with empty product_code
  const cleanRows = rows.filter((r) => r.product_code && r.product_code !== "UNKNOWN" && r.product_code.length >= VALIDATION_RULES.minProductCodeLength);

  let insertedCount = 0;
  try {
    // Try full insert in batches of 50
    for (let i = 0; i < cleanRows.length; i += 50) {
      const batch = cleanRows.slice(i, i + 50);
      const { error } = await (supabase.from("supplier_products") as any).insert(batch);
      if (error) {
        console.error(`[Pipeline] Batch ${Math.floor(i / 50) + 1} failed:`, error);
        throw error;
      }
      insertedCount += batch.length;
    }
  } catch (fullErr: any) {
    console.warn("[Pipeline] Full insert failed, trying basic fallback:", fullErr.message);
    insertedCount = 0;

    // Fallback: only guaranteed-safe columns
    const basicRows = cleanRows.map((r) => ({
      supplier_id: r.supplier_id,
      product_code: r.product_code,
      short_name: r.short_name,
      description: r.description,
      category: r.category,
      brand: r.brand,
      cost_price: r.cost_price || 0,
      cost_excl_vat: r.cost_excl_vat || 0,
      default_markup_percent: r.default_markup_percent || PRICING_RULES.defaultMarkupPercent,
      is_active: true,
      archived: false,
    }));

    for (let i = 0; i < basicRows.length; i += 50) {
      const batch = basicRows.slice(i, i + 50);
      const { error } = await (supabase.from("supplier_products") as any).insert(batch);
      if (error) {
        console.error(`[Pipeline] Basic fallback batch failed:`, error);
        return {
          success: false,
          productsImported: insertedCount,
          productsSkipped: skipped,
          pdfUploadId,
          purgedProducts: purgeResult.deletedProducts,
          purgedPdfs: purgeResult.deletedPdfs,
          validationWarnings: warnings,
          error: `Insert failed: ${error.message}`,
        };
      }
      insertedCount += batch.length;
    }
  }

  // ── STEP 5: AUDIT LOG ──
  const isPdf = file?.name.toLowerCase().endsWith(".pdf") ?? false;
  await logImportAction({
    supplierId,
    action: isPdf ? "pdf_import" : "csv_import",
    productsImported: insertedCount,
    fileName: file?.name || "unknown",
  });

  console.log(`[Pipeline] ✅ Complete — ${insertedCount} products imported, ${skipped} skipped`);

  return {
    success: true,
    productsImported: insertedCount,
    productsSkipped: skipped,
    pdfUploadId,
    purgedProducts: purgeResult.deletedProducts,
    purgedPdfs: purgeResult.deletedPdfs,
    validationWarnings: warnings,
  };
}
