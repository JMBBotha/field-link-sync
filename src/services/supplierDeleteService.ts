import { supabase } from "@/integrations/supabase/client";

/**
 * Complete FK dependency tree rooted at `suppliers`:
 *
 *   suppliers
 *     ├─ supplier_products        (CASCADE)
 *     │    ├─ quote_items         (SET NULL)
 *     │    ├─ job_used_parts      (SET NULL)
 *     │    ├─ inventory_stock     (CASCADE)
 *     │    ├─ bundle_items        (CASCADE)
 *     │    └─ pdf_product_regions (SET NULL)
 *     ├─ supplier_contacts        (CASCADE)
 *     ├─ supplier_documents       (CASCADE)
 *     ├─ price_list_uploads       (CASCADE)
 *     └─ stock_receipts           (CASCADE)
 */

// ── Storage buckets used by the supplier/PDF pipeline ────────────────
const STORAGE_BUCKETS = [
  "supplier-pdf-pages",  // Visual catalog page images
  "stock-documents",     // General stock/supplier docs
  "product-image",       // Product images
];

// ── helpers ──────────────────────────────────────────────────────────

async function deleteBatched(table: string, column: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    await (supabase.from(table as any) as any).delete().in(column, batch);
  }
}

async function getProductIds(supplierId: string): Promise<string[]> {
  const { data } = await (supabase.from("supplier_products") as any)
    .select("id")
    .eq("supplier_id", supplierId);
  return (data || []).map((p: any) => p.id);
}

/**
 * Purge all files in a storage bucket folder matching `supplierId/`.
 * Also removes root-level files containing the supplier ID.
 */
async function purgeStorageFolder(bucket: string, supplierId: string) {
  try {
    // List and delete files in supplier subfolder
    const { data: subFiles } = await supabase.storage.from(bucket).list(supplierId);
    if (subFiles && subFiles.length > 0) {
      // Handle nested folders recursively (one level deep)
      for (const item of subFiles) {
        if (!item.id) {
          // It's a folder — list its contents
          const { data: nested } = await supabase.storage
            .from(bucket)
            .list(`${supplierId}/${item.name}`);
          if (nested && nested.length > 0) {
            const nestedPaths = nested.map((f) => `${supplierId}/${item.name}/${f.name}`);
            await supabase.storage.from(bucket).remove(nestedPaths);
          }
        }
      }
      const filePaths = subFiles
        .filter((f) => f.id) // only actual files
        .map((f) => `${supplierId}/${f.name}`);
      if (filePaths.length > 0) {
        await supabase.storage.from(bucket).remove(filePaths);
      }
    }
  } catch {
    // Bucket may not exist or folder empty — safe to ignore
  }
}

/**
 * Remove specific storage files by extracting paths from page_image_url columns.
 */
async function purgeSupplierPdfPageImages(supplierId: string) {
  const { data: pages } = await (supabase.from("supplier_pdf_pages") as any)
    .select("page_image_url, pdf_filename")
    .eq("supplier_id", supplierId);

  if (!pages || pages.length === 0) return 0;

  // Delete individual page images from storage
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

  // Delete source PDF file from storage
  const filename = pages[0]?.pdf_filename;
  if (filename) {
    await supabase.storage.from("supplier-pdf-pages").remove([`${supplierId}/${filename}`]);
  }

  return pages.length;
}

/**
 * Remove storage files referenced by supplier_documents rows.
 */
async function purgeSupplierDocumentFiles(supplierId: string) {
  const { data: docs } = await (supabase.from("supplier_documents") as any)
    .select("storage_path")
    .eq("supplier_id", supplierId);

  if (!docs || docs.length === 0) return;

  const paths = docs
    .map((d: any) => d.storage_path)
    .filter(Boolean) as string[];

  if (paths.length > 0) {
    // Documents are stored in stock-documents bucket
    await supabase.storage.from("stock-documents").remove(paths).catch(() => {});
    // Also try supplier-pdf-pages in case they were stored there
    await supabase.storage.from("supplier-pdf-pages").remove(paths).catch(() => {});
  }
}

/**
 * Remove product image files from storage.
 */
async function purgeProductImages(productIds: string[]) {
  if (productIds.length === 0) return;

  // Fetch image URLs from products
  const { data: products } = await (supabase.from("supplier_products") as any)
    .select("id, image_url")
    .in("id", productIds.slice(0, 500));

  if (!products) return;

  const imagePaths = products
    .map((p: any) => {
      const url = p.image_url || "";
      const match = url.match(/product-image\/(.+)$/);
      return match ? match[1] : null;
    })
    .filter(Boolean) as string[];

  if (imagePaths.length > 0) {
    await supabase.storage.from("product-image").remove(imagePaths).catch(() => {});
  }
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

  // Count PDF page images in storage
  const { data: pdfPages } = await (supabase.from("supplier_pdf_pages") as any)
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId);

  return {
    products: productCount ?? 0,
    pdfs: pdfCount ?? 0,
    contacts: contactCount ?? 0,
    pdfPages: (pdfPages as any)?.length ?? 0,
  };
}

/**
 * Archives all products for this supplier and deactivates its PDF books.
 * Never deletes products, books or quote lines (existing quotes unchanged).
 */
export async function deleteSupplierProductsOnly(supplierId: string): Promise<{
  success: true;
  deletedProducts: number;
  deletedPdfPages: number;
}> {
  const archived = await archiveSupplierProducts(supplierId);
  await deactivatePdfUploads({ supplierId });
  return { success: true, deletedProducts: archived, deletedPdfPages: 0 };
}

/**
 * Removes the supplier record — blocked while the supplier has any products
 * (live or archived), because products are never hard-deleted.
 */
export async function deleteSupplierCompletely(supplierId: string) {
  const { count } = await (supabase.from("supplier_products") as any)
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId);
  if ((count ?? 0) > 0) {
    throw new Error(
      `This supplier has ${count} products. Products are never deleted — archive them instead. Existing quotes are not changed.`,
    );
  }
  await (supabase.from("supplier_contacts") as any).delete().eq("supplier_id", supplierId);
  const { error } = await supabase.from("suppliers").delete().eq("id", supplierId);
  if (error) throw error;
  return { success: true, deletedProducts: 0, deletedPdfPages: 0 };
}

/**
 * Wipes ALL suppliers from the database and storage completely.
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

  // Final sweep — purge any remaining files in all storage buckets
  for (const bucket of STORAGE_BUCKETS) {
    try {
      const { data: remaining } = await supabase.storage.from(bucket).list("");
      if (remaining && remaining.length > 0) {
        // Delete files
        const files = remaining.filter((f) => f.id).map((f) => f.name);
        if (files.length > 0) {
          await supabase.storage.from(bucket).remove(files);
        }
        // Delete folders (list and purge contents)
        const folders = remaining.filter((f) => !f.id);
        for (const folder of folders) {
          const { data: contents } = await supabase.storage
            .from(bucket)
            .list(folder.name);
          if (contents && contents.length > 0) {
            const paths = contents.map((f) => `${folder.name}/${f.name}`);
            await supabase.storage.from(bucket).remove(paths);
          }
        }
      }
    } catch {
      // Bucket may not exist
    }
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
    const { count } = await (supabase.from("supplier_products") as any)
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  }

  const { count } = await (supabase.from("supplier_products") as any)
    .select("id", { count: "exact", head: true })
    .not("supplier_id", "in", `(${supplierIds.join(",")})`);

  return count ?? 0;
}

/**
 * Deletes all orphan products and their storage files.
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
    await purgeProductImages(orphanProducts);
    await deleteBatched("quote_items", "product_id", orphanProducts);
    await deleteBatched("job_used_parts", "product_id", orphanProducts);
    await deleteBatched("pdf_product_regions", "product_id", orphanProducts);
    await deleteBatched("supplier_products", "id", orphanProducts);
  }

  return orphanProducts.length;
}
