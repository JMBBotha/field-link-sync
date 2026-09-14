/**
 * Catalog source of truth (equipment + materials) — HARD FILTER.
 *
 * A supplier product may only be offered for adding to a quote (picker,
 * voice, catalog search, guided selector) when it matches ALL of:
 *
 *   archived = false
 *   AND is_active = true
 *   AND pdf_upload_id IN (SELECT id FROM pdf_uploads WHERE is_active = true)
 *
 * `archived` alone is NOT enough: soft-archived rows keep `is_active = true`.
 *
 * Services are a PARALLEL source of truth (`hvac_services` / `service_templates`)
 * and are never filtered by this module. Existing quote lines are never touched.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CatalogAllowlist {
  /** product_id values that have at least one PDF overlay region (informational). */
  ids: Set<string>;
  /** product_code values (upper-cased) that have at least one PDF overlay region (informational). */
  codes: Set<string>;
  /** pdf_uploads.id values still marked active — the primary lock. */
  activeUploadIds: Set<string>;
  /**
   * True when at least one active Visual PDF book exists. When true, every
   * quote-addable product MUST carry a pdf_upload_id in `activeUploadIds`.
   * When false (no books at all / lookup failed) we fall back to
   * archived=false + is_active=true only, so the picker is never emptied by a
   * transient failure.
   */
  enforced: boolean;
}

const EMPTY: CatalogAllowlist = {
  ids: new Set(),
  codes: new Set(),
  activeUploadIds: new Set(),
  enforced: false,
};

/** Read the ids of the active Visual PDF books. Safe: failure returns an empty set. */
export async function fetchActiveUploadIds(): Promise<Set<string>> {
  try {
    const { data } = await (supabase.from("pdf_uploads") as any).select("id, is_active").limit(2000);
    const out = new Set<string>();
    for (const u of (data || []) as any[]) {
      // Older rows predate the flag — treat missing as active.
      if (u.is_active !== false) out.add(u.id);
    }
    return out;
  } catch (e) {
    console.warn("[catalogSoT] pdf_uploads lookup failed — falling back to archived/is_active only", e);
    return new Set();
  }
}

/** Read the current Visual-PDF allowlist. Safe: any failure returns a non-enforcing list. */
export async function fetchVisualCatalogAllowlist(): Promise<CatalogAllowlist> {
  try {
    const [regionsRes, activeUploadIds] = await Promise.all([
      (supabase.from("pdf_product_regions") as any).select("product_id, product_code").limit(20000),
      fetchActiveUploadIds(),
    ]);

    const ids = new Set<string>();
    const codes = new Set<string>();
    for (const r of (regionsRes.data || []) as any[]) {
      if (r.product_id) ids.add(r.product_id);
      if (r.product_code) codes.add(String(r.product_code).trim().toUpperCase());
    }

    return { ids, codes, activeUploadIds, enforced: activeUploadIds.size > 0 };
  } catch (e) {
    console.warn("[catalogSoT] Allowlist lookup failed — showing all non-archived active products", e);
    return EMPTY;
  }
}

type LiveRow = {
  id?: string | null;
  product_code?: string | null;
  pdf_upload_id?: string | null;
  archived?: boolean | null;
  is_active?: boolean | null;
};

/**
 * Apply the live-catalog predicate to a `supplier_products` query builder.
 * Always adds archived=false + is_active=true; adds the active-book
 * `pdf_upload_id IN (...)` clause whenever at least one active book exists.
 */
export function applyLiveCatalogFilter<Q extends { or: any; eq: any; in: any }>(
  query: Q,
  activeUploadIds: Set<string>,
): Q {
  let q: any = query.or("archived.is.null,archived.eq.false").eq("is_active", true);
  if (activeUploadIds.size > 0) q = q.in("pdf_upload_id", [...activeUploadIds]);
  return q as Q;
}

/** True when this product row is quote-addable under the hard SoT rule. */
export function isLiveCatalogProduct(p: LiveRow, allow: CatalogAllowlist | Set<string>): boolean {
  if (p.archived === true) return false;
  if (p.is_active === false) return false;
  const active = allow instanceof Set ? allow : allow.activeUploadIds;
  if (active.size === 0) return true; // no active books at all → archived/is_active only
  return !!p.pdf_upload_id && active.has(p.pdf_upload_id);
}

/** @deprecated alias kept for existing callers — same hard rule as isLiveCatalogProduct. */
export function isOnVisualCatalog(p: LiveRow, allow: CatalogAllowlist): boolean {
  return isLiveCatalogProduct(p, allow);
}

/** Filter a product list down to the live catalog (hard rule). */
export function filterToVisualCatalog<T extends LiveRow>(products: T[], allow: CatalogAllowlist | Set<string>): T[] {
  return products.filter((p) => isLiveCatalogProduct(p, allow));
}
