/**
 * SPECIALS OVERLAY: supplier specials never touch supplier_products prices.
 * A special only changes cost on ONE quote line when the user says Yes
 * (metadata.special + metadata.price_overridden); standard markup still applies on top.
 */
import { supabase } from "@/integrations/supabase/client";

export interface SupplierSpecial {
  id: string;
  supplier_id: string | null;
  model_number: string;
  supplier_product_id: string | null;
  special_cost: number;
  start_date: string; // yyyy-mm-dd
  end_date: string;
  specials_pdf_path: string | null;
  notes: string | null;
  is_active: boolean;
}

/** Case/space/hyphen-insensitive model key. */
export const normModel = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[\s\-_/]+/g, "");

export const todayIso = (d: Date = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export function isSpecialRunning(s: SupplierSpecial, date: string = todayIso()) {
  return s.is_active && s.start_date <= date && date <= s.end_date;
}

/** Pick the running special for a product id or model number (lowest cost wins if several). */
export function pickActiveSpecial(
  list: SupplierSpecial[],
  key: { productId?: string | null; modelNumber?: string | null },
  date: string = todayIso(),
): SupplierSpecial | null {
  const m = normModel(key.modelNumber);
  const hits = list.filter(
    (s) => isSpecialRunning(s, date) &&
      ((key.productId && s.supplier_product_id === key.productId) || (m && normModel(s.model_number) === m)),
  );
  if (!hits.length) return null;
  return hits.reduce((a, b) => (Number(b.special_cost) < Number(a.special_cost) ? b : a));
}

/** getActiveSpecial(productId | modelNumber, date = today). Returns null for techs (RLS). */
export async function getActiveSpecial(
  key: { productId?: string | null; modelNumber?: string | null },
  date: string = todayIso(),
): Promise<SupplierSpecial | null> {
  const { data, error } = await (supabase.from("supplier_specials" as any) as any)
    .select("*").eq("is_active", true).lte("start_date", date).gte("end_date", date);
  if (error || !data) return null;
  return pickActiveSpecial(data as SupplierSpecial[], key, date);
}

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
};

/** Line metadata stamped when the user accepts the special for THIS line. */
export function specialLineMeta(s: SupplierSpecial, normalCost: number) {
  return {
    special: { id: s.id, cost: Number(s.special_cost), normal_cost: normalCost, end_date: s.end_date, pdf_path: s.specials_pdf_path },
    price_overridden: true,
  };
}

export async function signedSpecialsPdfUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("specials-pdfs").createSignedUrl(path, 600);
  return error ? null : data?.signedUrl ?? null;
}
