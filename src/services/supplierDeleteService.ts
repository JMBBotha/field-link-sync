import { supabase } from "@/integrations/supabase/client";

/**
 * Deletes all products and dependent records for a supplier,
 * then removes the supplier itself along with contacts and PDFs.
 */
export async function deleteSupplierCompletely(supplierId: string) {
  await deleteSupplierProductsOnly(supplierId);

  // Delete contacts
  await (supabase.from("supplier_contacts") as any).delete().eq("supplier_id", supplierId);

  // Delete the supplier record
  await supabase.from("suppliers").delete().eq("id", supplierId);

  return { success: true };
}

/**
 * Deletes all products, dependent FK rows, and PDF uploads for a supplier
 * but keeps the supplier record intact for re-upload.
 *
 * Deletion order:
 *   quote_items → job_used_parts → inventory_stock → bundle_items
 *   → pdf_product_regions → supplier_products → pdf_uploads
 */
export async function deleteSupplierProductsOnly(supplierId: string) {
  // 1. Gather product IDs
  const { data: products } = await (supabase.from("supplier_products") as any)
    .select("id")
    .eq("supplier_id", supplierId);
  const productIds: string[] = (products || []).map((p: any) => p.id);

  // 2. Gather PDF upload IDs
  const { data: pdfs } = await (supabase.from("pdf_uploads") as any)
    .select("id")
    .eq("supplier_id", supplierId);
  const pdfIds: string[] = (pdfs || []).map((p: any) => p.id);

  // 3. Delete product-dependent rows (FK order)
  if (productIds.length > 0) {
    // Process in batches of 500 to avoid query-size limits
    for (let i = 0; i < productIds.length; i += 500) {
      const batch = productIds.slice(i, i + 500);
      await (supabase.from("quote_items") as any).delete().in("product_id", batch);
      await (supabase.from("job_used_parts") as any).delete().in("product_id", batch);
      await supabase.from("inventory_stock").delete().in("product_id", batch);
      await supabase.from("bundle_items").delete().in("supplier_product_id", batch);
    }
  }

  // 4. Delete PDF region mappings
  if (pdfIds.length > 0) {
    for (let i = 0; i < pdfIds.length; i += 500) {
      const batch = pdfIds.slice(i, i + 500);
      await (supabase.from("pdf_product_regions") as any).delete().in("pdf_upload_id", batch);
    }
  }

  // 5. Delete products themselves
  await (supabase.from("supplier_products") as any).delete().eq("supplier_id", supplierId);

  // 6. Delete PDF uploads
  await (supabase.from("pdf_uploads") as any).delete().eq("supplier_id", supplierId);

  return { success: true, deletedProducts: productIds.length, deletedPdfs: pdfIds.length };
}

/**
 * Pre-flight counts for the confirmation dialog.
 */
export async function getSupplierDeleteCounts(supplierId: string) {
  const { count: productCount } = await (supabase.from("supplier_products") as any)
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId);

  const { count: pdfCount } = await (supabase.from("pdf_uploads") as any)
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId);

  const { count: contactCount } = await (supabase.from("supplier_contacts") as any)
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId);

  return {
    products: productCount ?? 0,
    pdfs: pdfCount ?? 0,
    contacts: contactCount ?? 0,
  };
}
