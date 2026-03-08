import { supabase } from "@/integrations/supabase/client";

/**
 * Deletes a single price_list_uploads entry AND all associated
 * supplier_products for that supplier, plus storage files.
 */
export async function deletePriceListUpload(uploadId: string): Promise<{
  success: boolean;
  productsDeleted: number;
  error?: string;
}> {
  try {
    // 1. Fetch the upload row to get supplier_id
    const { data: upload, error: fetchErr } = await (supabase.from("price_list_uploads") as any)
      .select("id, supplier_id, file_path, storage_path")
      .eq("id", uploadId)
      .maybeSingle();

    if (fetchErr || !upload) {
      return { success: false, productsDeleted: 0, error: fetchErr?.message || "Upload not found" };
    }

    const supplierId = upload.supplier_id;

    // 2. Clean all products for this supplier
    const result = await cleanSupplierProducts(supplierId);

    // 3. Delete the price_list_uploads row
    await (supabase.from("price_list_uploads") as any).delete().eq("id", uploadId);

    // 4. Try removing storage file
    const rawPath = upload.file_path || upload.storage_path || "";
    if (rawPath) {
      const match = rawPath.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
      const cleanPath = match ? match[1] : rawPath;
      for (const bucket of ["pdfs", "price-lists", "supplier-pdfs", "supplier-pdf-pages"]) {
        try { await supabase.storage.from(bucket).remove([cleanPath]); } catch {}
      }
    }

    return { success: true, productsDeleted: result.deletedProducts };
  } catch (err: any) {
    return { success: false, productsDeleted: 0, error: err.message };
  }
}

/**
 * Removes ALL supplier_products for a supplier and cleans up
 * dependent records (pdf_product_regions, inventory_stock, bundle_items,
 * quote_items, job_used_parts) plus product images from storage.
 */
export async function cleanSupplierProducts(supplierId: string): Promise<{
  success: boolean;
  deletedProducts: number;
}> {
  // Collect all product IDs
  const allIds: string[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await (supabase.from("supplier_products") as any)
      .select("id")
      .eq("supplier_id", supplierId)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    allIds.push(...data.map((p: any) => p.id));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  if (allIds.length === 0) return { success: true, deletedProducts: 0 };

  // Batch-delete dependents then products
  for (let i = 0; i < allIds.length; i += 500) {
    const batch = allIds.slice(i, i + 500);
    await (supabase.from("quote_items") as any).delete().in("product_id", batch);
    await (supabase.from("job_used_parts") as any).delete().in("product_id", batch);
    await (supabase.from("inventory_stock") as any).delete().in("product_id", batch);
    await (supabase.from("bundle_items") as any).delete().in("supplier_product_id", batch);
    await (supabase.from("pdf_product_regions") as any).delete().in("product_id", batch);
    await (supabase.from("supplier_products") as any).delete().in("id", batch);
  }

  // Clean product images from storage
  try {
    const { data: files } = await supabase.storage.from("product-image").list(supplierId);
    if (files?.length) {
      const paths = files.filter((f) => f.id).map((f) => `${supplierId}/${f.name}`);
      if (paths.length > 0) await supabase.storage.from("product-image").remove(paths);
    }
  } catch {}

  return { success: true, deletedProducts: allIds.length };
}
