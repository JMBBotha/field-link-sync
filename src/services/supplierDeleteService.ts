import { supabase } from "@/integrations/supabase/client";

/**
 * Deletes a supplier and ALL dependent data across every FK chain.
 *
 * Full FK tree rooted at `suppliers`:
 *   suppliers
 *     ├─ supplier_products
 *     │    ├─ quote_items         (product_id)
 *     │    ├─ job_used_parts      (product_id)
 *     │    ├─ inventory_stock     (product_id)
 *     │    ├─ bundle_items        (supplier_product_id)
 *     │    └─ pdf_product_regions (product_id)
 *     ├─ supplier_contacts        (supplier_id)
 *     ├─ supplier_documents       (supplier_id)
 *     ├─ price_list_uploads       (supplier_id)
 *     └─ stock_receipts           (supplier_id)
 */

// ── helpers ──────────────────────────────────────────────────────────
async function deleteBatched(table: string, column: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    await (supabase.from(table) as any).delete().in(column, batch);
  }
}

// ── public API ───────────────────────────────────────────────────────

/**
 * Removes every product + PDF + dependent row for a supplier,
 * then deletes contacts, documents, receipts, price-list uploads,
 * and the supplier record itself.
 */
export async function deleteSupplierCompletely(supplierId: string) {
  await deleteSupplierProductsOnly(supplierId);

  // Delete remaining supplier-level children
  await (supabase.from("supplier_contacts") as any).delete().eq("supplier_id", supplierId);
  await (supabase.from("supplier_documents") as any).delete().eq("supplier_id", supplierId);
  await (supabase.from("price_list_uploads") as any).delete().eq("supplier_id", supplierId);
  await (supabase.from("stock_receipts") as any).delete().eq("supplier_id", supplierId);

  // Finally delete the supplier
  await supabase.from("suppliers").delete().eq("id", supplierId);

  return { success: true };
}

/**
 * Clears all products, their FK dependents, and PDF uploads
 * but keeps the supplier record for re-upload.
 *
 * Deletion order (leaves → parents):
 *   quote_items → job_used_parts → inventory_stock → bundle_items
 *   → pdf_product_regions → supplier_products → pdf_uploads
 */
export async function deleteSupplierProductsOnly(supplierId: string) {
  // 1. Gather product IDs (including archived)
  const { data: products } = await (supabase.from("supplier_products") as any)
    .select("id")
    .eq("supplier_id", supplierId);
  const productIds: string[] = (products || []).map((p: any) => p.id);

  // 2. Delete product-dependent rows (FK order)
  if (productIds.length > 0) {
    await deleteBatched("quote_items", "product_id", productIds);
    await deleteBatched("job_used_parts", "product_id", productIds);
    await deleteBatched("inventory_stock", "product_id", productIds);
    await deleteBatched("bundle_items", "supplier_product_id", productIds);
    await deleteBatched("pdf_product_regions", "product_id", productIds);
  }

  // 3. Delete the products themselves
  await (supabase.from("supplier_products") as any).delete().eq("supplier_id", supplierId);

  // 4. Delete PDF uploads (no FK children point at pdf_uploads)
  await (supabase.from("pdf_uploads") as any).delete().eq("supplier_id", supplierId);

  // 5. Delete price-list uploads & supplier documents (they reference supplier_id)
  await (supabase.from("price_list_uploads") as any).delete().eq("supplier_id", supplierId);
  await (supabase.from("supplier_documents") as any).delete().eq("supplier_id", supplierId);

  return { success: true, deletedProducts: productIds.length };
}

/**
 * Pre-flight counts shown in the confirmation dialog.
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
