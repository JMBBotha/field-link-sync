import { supabase } from "@/integrations/supabase/client";
import type { AcUnitProductInput } from "@/lib/lineDisplay";

/** Catalogue fields that tell an AC unit apart from materials (labour detection uses these before the line name). */
export const AC_PRODUCT_FIELDS = "id, product_category, category, subcategory, product_type, unit_type, capacity_btu, btu_rating, kw";

const cache = new Map<string, AcUnitProductInput | null>();

/** Load (cached) catalogue info for the lines' product ids. Never throws: on error lines fall back to name detection. */
export async function loadAcProductInfo(ids: (string | null | undefined)[]): Promise<Map<string, AcUnitProductInput | null>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const missing = want.filter((id) => !cache.has(id));
  if (missing.length) {
    try {
      const { data, error } = await (supabase.from("supplier_products") as any).select(AC_PRODUCT_FIELDS).in("id", missing);
      if (!error) {
        for (const row of (data || []) as any[]) cache.set(row.id, row);
        for (const id of missing) if (!cache.has(id)) cache.set(id, null);
      }
    } catch { /* fall back to the name */ }
  }
  return new Map(want.map((id) => [id, cache.get(id) ?? null]));
}

/** Lines with `product` attached from the catalogue (existing `product` kept). */
export async function withAcProducts<T extends { product_id?: string | null; product?: any }>(lines: T[]): Promise<T[]> {
  const info = await loadAcProductInfo(lines.map((l) => l.product_id));
  return lines.map((l) => (l.product || !l.product_id ? l : { ...l, product: info.get(l.product_id) ?? null }));
}
