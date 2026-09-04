/**
 * Catalog source of truth (equipment + materials).
 *
 * Rule: a supplier product may only appear in a quote picker when it is
 * (a) not archived AND (b) still linked to the current Visual PDF book —
 * either it has an overlay region on a PDF page (`pdf_product_regions`), or
 * it carries a `pdf_upload_id` pointing at a brochure upload that is still
 * marked active (`pdf_uploads.is_active`).
 *
 * Services are a PARALLEL source of truth (`hvac_services.is_active`) and are
 * never filtered by this module.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CatalogAllowlist {
  /** product_id values that have at least one PDF overlay region. */
  ids: Set<string>;
  /** product_code values (upper-cased) that have at least one PDF overlay region. */
  codes: Set<string>;
  /** pdf_uploads.id values still marked active. */
  activeUploadIds: Set<string>;
  /**
   * False when nothing could be resolved (no regions and no active uploads).
   * Callers then fall back to "archived only" filtering so the picker is never
   * emptied out by a missing/not-yet-built allowlist.
   */
  enforced: boolean;
}

const EMPTY: CatalogAllowlist = {
  ids: new Set(),
  codes: new Set(),
  activeUploadIds: new Set(),
  enforced: false,
};

/** Read the current Visual-PDF allowlist. Safe: any failure returns a non-enforcing list. */
export async function fetchVisualCatalogAllowlist(): Promise<CatalogAllowlist> {
  try {
    const [regionsRes, uploadsRes] = await Promise.all([
      (supabase.from("pdf_product_regions") as any).select("product_id, product_code").limit(20000),
      (supabase.from("pdf_uploads") as any).select("id, is_active").limit(2000),
    ]);

    const ids = new Set<string>();
    const codes = new Set<string>();
    for (const r of (regionsRes.data || []) as any[]) {
      if (r.product_id) ids.add(r.product_id);
      if (r.product_code) codes.add(String(r.product_code).trim().toUpperCase());
    }

    const activeUploadIds = new Set<string>();
    for (const u of (uploadsRes.data || []) as any[]) {
      // Older rows predate the flag — treat missing as active.
      if (u.is_active !== false) activeUploadIds.add(u.id);
    }

    const enforced = ids.size > 0 || codes.size > 0 || activeUploadIds.size > 0;
    return { ids, codes, activeUploadIds, enforced };
  } catch (e) {
    console.warn("[catalogSoT] Allowlist lookup failed — showing all non-archived products", e);
    return EMPTY;
  }
}

/** True when this product row is still part of the current Visual PDF book. */
export function isOnVisualCatalog(
  p: { id?: string | null; product_code?: string | null; pdf_upload_id?: string | null },
  allow: CatalogAllowlist,
): boolean {
  if (!allow.enforced) return true;
  if (p.id && allow.ids.has(p.id)) return true;
  const code = (p.product_code || "").trim().toUpperCase();
  if (code && allow.codes.has(code)) return true;
  if (p.pdf_upload_id && allow.activeUploadIds.has(p.pdf_upload_id)) return true;
  return false;
}

/** Filter a product list down to the current Visual PDF book (no-op when not enforced). */
export function filterToVisualCatalog<
  T extends { id?: string | null; product_code?: string | null; pdf_upload_id?: string | null },
>(products: T[], allow: CatalogAllowlist): T[] {
  if (!allow.enforced) return products;
  return products.filter((p) => isOnVisualCatalog(p, allow));
}
