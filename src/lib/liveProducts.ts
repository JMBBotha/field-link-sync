import { supabase } from "@/integrations/supabase/client";

/**
 * The ONLY quotable products: rows on the latest live/active PDF price list
 * per supplier (not archived, is_active, pdf_upload_id on an active
 * pdf_uploads row). Every quote-facing product read goes through this.
 * Catalogue admin screens keep reading supplier_products (they need archived rows).
 */
export const LIVE_PRODUCTS_SOURCE = "live_supplier_products" as const;

export function liveProducts(): any {
  return (supabase.from(LIVE_PRODUCTS_SOURCE as any) as any);
}

/** Ids from `ids` that are currently quotable (for favourites / bundle items). */
export async function filterLiveIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 300) {
    const { data } = await liveProducts().select("id").in("id", uniq.slice(i, i + 300));
    (data || []).forEach((r: any) => out.add(r.id));
  }
  return out;
}
