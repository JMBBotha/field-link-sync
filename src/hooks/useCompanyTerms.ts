import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RELOCATION_CLAUSE_DEFAULT } from "@/lib/relocationClause";

export type CompanyTermsRow = { company_id: string; relocation_clause: string; updated_at: string };

/* Module cache so every document on a page shares one read; no QueryClient needed (PDF/print roots render without one). */
let cache: Promise<CompanyTermsRow | null> | null = null;
export function loadCompanyTerms(force = false): Promise<CompanyTermsRow | null> {
  if (!cache || force) {
    cache = (async () => {
      try {
        const { data } = await (supabase.from("company_terms" as any) as any).select("company_id, relocation_clause, updated_at").limit(1).maybeSingle();
        return (data as CompanyTermsRow | null) ?? null;
      } catch { return null; }
    })();
  }
  return cache;
}

/** The one company-wide terms record (main company). Readable by everyone, written by the main admin only. */
export function useCompanyTerms(enabled = true) {
  const [data, setData] = useState<CompanyTermsRow | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadCompanyTerms(tick > 0).then((r) => { if (live) setData(r); });
    return () => { live = false; };
  }, [enabled, tick]);
  return { data, refresh: () => setTick((t) => t + 1) };
}

export const relocationTextOf = (row?: { relocation_clause?: string | null } | null) =>
  (row?.relocation_clause || "").trim() || RELOCATION_CLAUSE_DEFAULT;
