import { supabase } from "@/integrations/supabase/client";

/**
 * Complete FK dependency tree rooted at `suppliers`:
 *
 *   suppliers
 *     ├─ supplier_products        (CASCADE)
 *     │    ├─ quote_items         (SET NULL)  ← explicit delete needed
 *     │    ├─ job_used_parts      (SET NULL)  ← explicit delete needed
 *     │    ├─ inventory_stock     (CASCADE)
 *     │    ├─ bundle_items        (CASCADE)
 *     │    └─ pdf_product_regions (SET NULL)  ← explicit delete needed
 *     ├─ supplier_contacts        (CASCADE)
 *     ├─ supplier_documents       (CASCADE)
 *     ├─ price_list_uploads       (CASCADE)
 *     └─ stock_receipts           (CASCADE)
 *
 * Even though CASCADE handles most, we explicitly delete SET NULL children
 * so they don't leave orphan rows pointing at nothing.
 */

// ── helpers ──────────────────────────────────────────────────────────

async function deleteBatched(table: string, column: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    await (supabase.from(table) as any).delete().in(column, batch);
  }
}

async function getProductIds(supplierId: string): Promise<string[]> {
  const { data } = await (supabase.from("supplier_products") as any)
    .select("id")
    .eq("supplier_id", supplierId);
  return (data || []).map((p: any) => p.id);
}

// ── public API ───────────────────────────────────────────────────────

/**
 * Pre-flight counts for confirmation dialogs.
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

/**
 * Clears all products, their dependents, and PDF uploads.
 * Keeps the supplier record intact for re-upload.
 */
export async function deleteSupplierProductsOnly(supplierId: string) {
  const productIds = await getProductIds(supplierId);

  // Explicit cleanup of SET NULL FK children (won't block but avoids orphan rows)
  if (productIds.length > 0) {
    await deleteBatched("quote_items", "product_id", productIds);
    await deleteBatched("job_used_parts", "product_id", productIds);
    await deleteBatched("pdf_product_regions", "product_id", productIds);
    // CASCADE children (inventory_stock, bundle_items) handled automatically
  }

  // Delete products — CASCADE takes care of inventory_stock + bundle_items
  await (supabase.from("supplier_products") as any).delete().eq("supplier_id", supplierId);

  // Delete PDF uploads
  await (supabase.from("pdf_uploads") as any).delete().eq("supplier_id", supplierId);

  // Also clean supplier_documents and price_list_uploads (CASCADE from suppliers won't fire here)
  await (supabase.from("supplier_documents") as any).delete().eq("supplier_id", supplierId);
  await (supabase.from("price_list_uploads") as any).delete().eq("supplier_id", supplierId);

  // Clean supplier_pdf_pages and storage files
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
      .filter(Boolean);
    if (imagePaths.length > 0) {
      await supabase.storage.from("supplier-pdf-pages").remove(imagePaths);
    }
    const filename = pages[0]?.pdf_filename;
    if (filename) {
      await supabase.storage.from("supplier-pdf-pages").remove([`${supplierId}/${filename}`]);
    }
  }
  await (supabase.from("supplier_pdf_pages") as any).delete().eq("supplier_id", supplierId);

  return { success: true, deletedProducts: productIds.length };
}

/**
 * Removes EVERYTHING: products, PDFs, contacts, documents, and the supplier itself.
 */
export async function deleteSupplierCompletely(supplierId: string) {
  await deleteSupplierProductsOnly(supplierId);

  // These are CASCADE but let's be explicit in case the cascade didn't fire
  await (supabase.from("supplier_contacts") as any).delete().eq("supplier_id", supplierId);
  await (supabase.from("stock_receipts") as any).delete().eq("supplier_id", supplierId);

  // Delete the supplier record itself
  await supabase.from("suppliers").delete().eq("id", supplierId);

  return { success: true };
}

/**
 * Wipes ALL suppliers from the database completely.
 * Returns progress via optional callback.
 */
export async function deleteAllSuppliersCompletely(
  onProgress?: (current: number, total: number, name: string) => void
) {
  const { data: allSuppliers } = await supabase.from("suppliers").select("id, name");
  if (!allSuppliers || allSuppliers.length === 0) return { success: true, count: 0 };

  for (let i = 0; i < allSuppliers.length; i++) {
    onProgress?.(i + 1, allSuppliers.length, allSuppliers[i].name);
    await deleteSupplierCompletely(allSuppliers[i].id);
  }

  return { success: true, count: allSuppliers.length };
}

/**
 * Checks for orphan products (products whose supplier no longer exists).
 */
export async function getOrphanProductCount(): Promise<number> {
  const { data: suppliers } = await supabase.from("suppliers").select("id");
  const supplierIds = (suppliers || []).map((s) => s.id);

  if (supplierIds.length === 0) {
    // All products are orphans if no suppliers exist
    const { count } = await (supabase.from("supplier_products") as any)
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  }

  // Find products not in any supplier
  const { count } = await (supabase.from("supplier_products") as any)
    .select("id", { count: "exact", head: true })
    .not("supplier_id", "in", `(${supplierIds.join(",")})`);

  return count ?? 0;
}

/**
 * Deletes all orphan products (products with no valid supplier).
 */
export async function cleanOrphanProducts(): Promise<number> {
  const { data: suppliers } = await supabase.from("suppliers").select("id");
  const supplierIds = (suppliers || []).map((s) => s.id);

  let orphanProducts: string[] = [];

  if (supplierIds.length === 0) {
    const { data } = await (supabase.from("supplier_products") as any).select("id");
    orphanProducts = (data || []).map((p: any) => p.id);
  } else {
    const { data } = await (supabase.from("supplier_products") as any)
      .select("id")
      .not("supplier_id", "in", `(${supplierIds.join(",")})`);
    orphanProducts = (data || []).map((p: any) => p.id);
  }

  if (orphanProducts.length > 0) {
    await deleteBatched("quote_items", "product_id", orphanProducts);
    await deleteBatched("job_used_parts", "product_id", orphanProducts);
    await deleteBatched("pdf_product_regions", "product_id", orphanProducts);
    await deleteBatched("supplier_products", "id", orphanProducts);
  }

  return orphanProducts.length;
}
