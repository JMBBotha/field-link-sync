import { supabase } from "@/integrations/supabase/client";
import { archiveSupplierProducts, deactivatePdfUploads } from "@/services/catalogArchive";
import { validateProduct, VALIDATION_RULES, VALID_PRODUCT_CATEGORIES, type ProductCategory } from "@/config/pdfExtractionConfig";

/**
 * CLEAN IMPORT PIPELINE
 * "Clean" = archive old products + deactivate old books (never deletes).
 *
 * Validation uses shared rules from pdfExtractionConfig.ts
 */

/** Re-export for use by importers */
export { validateProduct, VALIDATION_RULES, VALID_PRODUCT_CATEGORIES };
export type { ProductCategory };
export async function cleanImportForSupplier(supplierId: string): Promise<{
  success: boolean;
  deletedProducts: number;
  deletedPdfs: number;
}> {
  // Archive only: never deletes products, books or quote lines.
  const deletedProducts = await archiveSupplierProducts(supplierId);
  const deletedPdfs = await deactivatePdfUploads({ supplierId });
  return { success: true, deletedProducts, deletedPdfs };
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
