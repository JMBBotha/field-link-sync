import { supabase } from "@/integrations/supabase/client";
import { archiveSupplierProducts, deactivatePdfUploads } from "@/services/catalogArchive";

/**
 * "Deletes" a price_list_uploads entry: archives that supplier's products and
 * deactivates its PDF books. Never deletes products or quote lines.
 */
export async function deletePriceListUpload(uploadId: string): Promise<{
  success: boolean;
  productsDeleted: number;
  error?: string;
}> {
  try {
    const { data: upload, error: fetchErr } = await (supabase.from("price_list_uploads") as any)
      .select("id, supplier_id, file_name")
      .eq("id", uploadId)
      .maybeSingle();
    if (fetchErr || !upload) {
      return { success: false, productsDeleted: 0, error: fetchErr?.message || "Upload not found" };
    }
    const result = await cleanSupplierProducts(upload.supplier_id);
    return { success: true, productsDeleted: result.deletedProducts };
  } catch (err: any) {
    return { success: false, productsDeleted: 0, error: err.message };
  }
}

/** Archives ALL live supplier_products for a supplier and deactivates its books. */
export async function cleanSupplierProducts(supplierId: string): Promise<{
  success: boolean;
  deletedProducts: number;
}> {
  const n = await archiveSupplierProducts(supplierId);
  await deactivatePdfUploads({ supplierId });
  return { success: true, deletedProducts: n };
}
