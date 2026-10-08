import { supabase } from "@/integrations/supabase/client";

/**
 * Catalogue "delete" = archive. Never deletes supplier_products, pdf_uploads,
 * quote_items, job_used_parts, inventory_stock or bundle_items — existing
 * quotes keep their lines; archived products simply can't be quoted any more.
 */
export const archivePatch = () => ({
  archived: true,
  is_active: false,
  archived_at: new Date().toISOString(),
});

export async function archiveProductIds(ids: string[]): Promise<number> {
  for (let i = 0; i < ids.length; i += 500) {
    const { error } = await (supabase.from("supplier_products") as any)
      .update(archivePatch())
      .in("id", ids.slice(i, i + 500));
    if (error) throw error;
  }
  return ids.length;
}

export async function archiveSupplierProducts(supplierId: string): Promise<number> {
  const { count } = await (supabase.from("supplier_products") as any)
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId)
    .or("archived.is.null,archived.eq.false");
  const { error } = await (supabase.from("supplier_products") as any)
    .update(archivePatch())
    .eq("supplier_id", supplierId)
    .or("archived.is.null,archived.eq.false");
  if (error) throw error;
  return count ?? 0;
}

export async function deactivatePdfUploads(filter: { id?: string; supplierId?: string; all?: boolean }): Promise<number> {
  let q = (supabase.from("pdf_uploads") as any).update({ is_active: false }, { count: "exact" }).eq("is_active", true);
  if (filter.id) q = q.eq("id", filter.id);
  else if (filter.supplierId) q = q.eq("supplier_id", filter.supplierId);
  else if (!filter.all) return 0;
  const { error, count } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Counts for the confirm dialog: live products + active price lists. */
export async function archiveCounts(supplierId?: string): Promise<{ products: number; books: number }> {
  let p = (supabase.from("supplier_products") as any)
    .select("id", { count: "exact", head: true })
    .or("archived.is.null,archived.eq.false");
  let b = (supabase.from("pdf_uploads") as any).select("id", { count: "exact", head: true }).eq("is_active", true);
  if (supplierId) { p = p.eq("supplier_id", supplierId); b = b.eq("supplier_id", supplierId); }
  const [pr, br] = await Promise.all([p, b]);
  return { products: pr.count ?? 0, books: br.count ?? 0 };
}

export function archiveMessage(products: number, books: number, who?: string): string {
  const pl = `${products} product${products === 1 ? "" : "s"}`;
  const bl = `${books} price list${books === 1 ? "" : "s"}`;
  return `Archive ${pl} and deactivate ${bl}${who ? ` for ${who}` : ""}. Existing quotes are not changed. Archived products can't be quoted.`;
}
