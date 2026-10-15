import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyProfile } from "@/lib/companyProfiles";

/**
 * Johan 2026-10-12 16:02: ALL company details on documents come from the company's own record.
 * Loads the default (non-archived) company_profiles row for `companyId`, or for the signed-in user's
 * own company when no id is given. RLS (cp_select) keeps each company to its own record.
 * Returns null while loading / when no record is readable (anonymous pages, field techs):
 * callers then fall back to the fixed block in companyIdentity.ts.
 */
const cache = new Map<string, Promise<CompanyProfile | null>>();

/**
 * Johan 15 Oct: the quote screen can switch Light/Bold, so every mounted document must repaint
 * immediately. Clearing the cache also tells the mounted hooks to re-read the company record.
 */
const listeners = new Set<() => void>();

export function subscribeDocumentCompanyProfile(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function clearDocumentCompanyProfileCache() {
  cache.clear();
  listeners.forEach((l) => l());
}

async function resolveCompanyId(companyId?: string | null): Promise<string | null> {
  if (companyId) return companyId;
  // Same lookup as useCompanySettings (non-React loader, may run outside AuthProvider on public pages).
  // eslint-disable-next-line local-auth/no-direct-auth
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) return null;
  const { getUserCompanyId } = await import("@/lib/tenantUtils");
  return getUserCompanyId(auth.user.id);
}

export async function loadDocumentCompanyProfile(companyId?: string | null): Promise<CompanyProfile | null> {
  try {
    const id = await resolveCompanyId(companyId);
    if (!id) return null;
    if (!cache.has(id)) {
      const p = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from as any)("company_profiles")
          .select("*")
          .eq("company_id", id)
          .is("archived_at", null)
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error || !data) return null;
        return data as CompanyProfile;
      })();
      cache.set(id, p);
      p.then((r) => { if (!r) cache.delete(id); }, () => cache.delete(id));
    }
    return await cache.get(id)!;
  } catch {
    return null;
  }
}

/**
 * @param companyId  the document's company (quote.company_id); omit = signed-in user's company
 * @param explicit   a profile the caller already has (invoice snapshot, public RPC); skips the fetch
 * @param enabled    false = never fetch (e.g. anonymous public pages)
 */
export function useDocumentCompanyProfile(
  companyId?: string | null,
  explicit?: Partial<CompanyProfile> | null,
  enabled = true,
): Partial<CompanyProfile> | null {
  const [loaded, setLoaded] = useState<CompanyProfile | null>(null);
  const skip = !!explicit?.legal_name || !enabled;
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    loadDocumentCompanyProfile(companyId).then((p) => { if (!cancelled) setLoaded(p); });
    return () => { cancelled = true; };
  }, [companyId, skip]);
  if (explicit?.legal_name) return explicit;
  return skip ? null : loaded;
}
