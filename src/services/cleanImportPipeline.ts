import { supabase } from "@/integrations/supabase/client";

/**
 * CLEAN IMPORT PIPELINE
 * Enforces: DELETE ALL old data for this supplier → THEN insert new data
 * Never upserts. Never merges. Always fresh.
 */
export async function cleanImportForSupplier(supplierId: string): Promise<{
  success: boolean;
  deletedProducts: number;
  deletedPdfs: number;
}> {
  console.log(`[CleanImport] Starting full purge for supplier ${supplierId}`);

  // ─── PHASE 1: Get all existing IDs ───
  const { data: existingProducts } = await (supabase.from("supplier_products") as any)
    .select("id")
    .eq("supplier_id", supplierId);
  const productIds = (existingProducts || []).map((p: any) => p.id);

  const { data: existingPdfs } = await (supabase.from("pdf_uploads") as any)
    .select("id, file_path, storage_path, file_url")
    .eq("supplier_id", supplierId);
  const pdfIds = (existingPdfs || []).map((p: any) => p.id);

  // ─── PHASE 2: Delete ALL dependent records (batch to avoid URL length issues) ───
  if (productIds.length > 0) {
    for (let i = 0; i < productIds.length; i += 200) {
      const batch = productIds.slice(i, i + 200);
      await safeDelete("quote_items", "product_id", batch);
      await safeDelete("job_used_parts", "product_id", batch);
      await safeDelete("inventory_stock", "product_id", batch);
      await safeDelete("bundle_items", "supplier_product_id", batch);
      await safeDelete("pdf_product_regions", "product_id", batch);
    }
  }

  // ─── PHASE 3: Delete ALL PDF-related records ───
  if (pdfIds.length > 0) {
    await safeDelete("pdf_product_regions", "pdf_upload_id", pdfIds);
  }

  // ─── PHASE 4: Delete ALL products ───
  await (supabase.from("supplier_products") as any).delete().eq("supplier_id", supplierId);

  // ─── PHASE 5: Delete ALL pdf_upload records ───
  await (supabase.from("pdf_uploads") as any).delete().eq("supplier_id", supplierId);

  // ─── PHASE 6: Delete stored PDF page cache (supplier_pdf_pages) ───
  try {
    const { data: pages } = await (supabase.from("supplier_pdf_pages") as any)
      .select("page_image_url, pdf_filename")
      .eq("supplier_id", supplierId);

    if (pages && pages.length > 0) {
      const imagePaths = pages
        .map((p: any) => {
          const url = p.page_image_url || "";
          const match = url.match(/supplier-pdf-pages\/(.+)$/);
          return match ? match[1] : null;
        })
        .filter(Boolean) as string[];

      if (imagePaths.length > 0) {
        await supabase.storage.from("supplier-pdf-pages").remove(imagePaths);
      }
    }
    await (supabase.from("supplier_pdf_pages") as any).delete().eq("supplier_id", supplierId);
  } catch (_) {
    // Table may not have data, that's fine
  }

  // ─── PHASE 7: Delete actual files from Storage ───
  for (const pdf of existingPdfs || []) {
    const rawPath = pdf.file_path || pdf.storage_path || pdf.file_url || "";
    const match = rawPath.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
    const cleanPath = match ? match[1] : rawPath;
    if (cleanPath) {
      for (const bucket of ["pdfs", "price-lists", "supplier-pdfs", "supplier-pdf-pages"]) {
        try {
          await supabase.storage.from(bucket).remove([cleanPath]);
        } catch (_) {}
      }
    }
  }

  // ─── PHASE 8: Sweep storage folders ───
  for (const bucket of ["pdfs", "price-lists", "supplier-pdfs", "supplier-pdf-pages", "product-image"]) {
    try {
      const { data: files } = await supabase.storage.from(bucket).list(supplierId);
      if (files?.length) {
        for (const item of files) {
          if (!item.id) {
            const { data: nested } = await supabase.storage.from(bucket).list(`${supplierId}/${item.name}`);
            if (nested?.length) {
              await supabase.storage.from(bucket).remove(nested.map((f) => `${supplierId}/${item.name}/${f.name}`));
            }
          }
        }
        const filePaths = files.filter((f) => f.id).map((f) => `${supplierId}/${f.name}`);
        if (filePaths.length > 0) {
          await supabase.storage.from(bucket).remove(filePaths);
        }
      }
    } catch (_) {}
  }

  // ─── PHASE 9: Verify clean state ───
  const { count: remainingProducts } = await (supabase.from("supplier_products") as any)
    .select("*", { count: "exact", head: true })
    .eq("supplier_id", supplierId);

  if ((remainingProducts || 0) > 0) {
    console.error(`[CleanImport] FAILED — ${remainingProducts} products still remain!`);
    throw new Error("Clean import verification failed — old data still exists");
  }

  console.log(`[CleanImport] Purge complete — 0 products, 0 PDFs for supplier ${supplierId}`);
  return { success: true, deletedProducts: productIds.length, deletedPdfs: pdfIds.length };
}

/** Safe delete that won't throw if table/column doesn't exist */
async function safeDelete(table: string, column: string, ids: string[]) {
  try {
    await (supabase.from(table) as any).delete().in(column, ids);
  } catch (_) {
    // Table or column may not exist — that's OK during cleanup
  }
}

/**
 * Log an import action to the audit trail.
 */
export async function logImportAction(entry: {
  supplierId: string;
  action: "clean_purge" | "pdf_import" | "csv_import";
  productsDeleted?: number;
  productsImported?: number;
  pdfsDeleted?: number;
  fileName?: string;
  importSettings?: Record<string, any>;
}) {
  try {
    await (supabase.from("import_audit_log") as any).insert({
      supplier_id: entry.supplierId,
      action: entry.action,
      products_deleted: entry.productsDeleted || 0,
      products_imported: entry.productsImported || 0,
      pdfs_deleted: entry.pdfsDeleted || 0,
      file_name: entry.fileName || null,
      import_settings: entry.importSettings || null,
    });
  } catch (err) {
    console.warn("[CleanImport] Failed to log audit:", err);
  }
}
