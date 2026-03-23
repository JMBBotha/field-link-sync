import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/* ────────── Types ────────── */

export interface BrochureRecord {
  id: string;
  name: string;
  brand: string;
  category: string | null;
  file_url: string;
  file_name: string;
  model_match_prefixes: string[];
  page_count: number;
  sort_order: number;
  is_active: boolean;
}

export interface AttachedBrochure {
  linkId: string;
  brochure: BrochureRecord;
  isAutoMatched: boolean;
  sortOrder: number;
}

interface UseQuoteBrochuresOptions {
  quoteId?: string | null;
  lineItemModelCodes: string[];
}

/* ────────── Pure matching logic ────────── */

function computeAutoMatches(
  allBrochures: BrochureRecord[],
  modelCodes: string[]
): string[] {
  const matched = new Set<string>();

  for (const brochure of allBrochures) {
    for (const code of modelCodes) {
      const upper = (code || "").toUpperCase().trim();
      if (!upper) continue;
      const hit = brochure.model_match_prefixes.some((prefix) =>
        upper.startsWith(prefix.toUpperCase().trim())
      );
      if (hit) {
        matched.add(brochure.id);
        break;
      }
    }
  }

  return Array.from(matched);
}

/* ────────── Hook ────────── */

export function useQuoteBrochures({ quoteId, lineItemModelCodes }: UseQuoteBrochuresOptions) {
  const [allBrochures, setAllBrochures] = useState<BrochureRecord[]>([]);
  const [attachedBrochures, setAttachedBrochures] = useState<AttachedBrochure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevCodesRef = useRef<string>("");

  // Fetch all active brochures once
  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase
        .from("product_brochures" as any)
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (err) {
        setError(err.message);
        return;
      }
      setAllBrochures((data || []) as unknown as BrochureRecord[]);
    })();
  }, []);

  // Fetch attached brochures for this quote
  const fetchAttached = useCallback(async () => {
    if (!quoteId) {
      setAttachedBrochures([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from("quote_brochures" as any)
        .select("*, brochure:product_brochures(*)" as any)
        .eq("quote_id", quoteId)
        .order("sort_order");
      if (err) throw new Error(err.message);
      setAttachedBrochures(
        ((data || []) as any[]).map((row: any) => ({
          linkId: row.id,
          brochure: row.brochure as BrochureRecord,
          isAutoMatched: row.is_auto_matched,
          sortOrder: row.sort_order,
        }))
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    fetchAttached();
  }, [fetchAttached]);

  // Sync auto-matched brochures when line items change
  useEffect(() => {
    if (!quoteId || allBrochures.length === 0) return;

    const codesKey = lineItemModelCodes.sort().join("|");
    if (codesKey === prevCodesRef.current) return;
    prevCodesRef.current = codesKey;

    (async () => {
      try {
        const autoIds = computeAutoMatches(allBrochures, lineItemModelCodes);

        // Get current auto-matched
        const { data: current } = await supabase
          .from("quote_brochures" as any)
          .select("id, brochure_id")
          .eq("quote_id", quoteId)
          .eq("is_auto_matched", true);

        const currentIds = new Set(((current || []) as any[]).map((r: any) => r.brochure_id));
        const newIds = new Set(autoIds);

        // Delete stale auto-matches
        const staleIds = ((current || []) as any[])
          .filter((r: any) => !newIds.has(r.brochure_id))
          .map((r: any) => r.id);
        if (staleIds.length > 0) {
          await supabase.from("quote_brochures" as any).delete().in("id", staleIds);
        }

        // Upsert new auto-matches
        const toUpsert = autoIds
          .filter((id) => !currentIds.has(id))
          .map((brochureId, i) => ({
            quote_id: quoteId,
            brochure_id: brochureId,
            is_auto_matched: true,
            sort_order: 1000 + i,
          }));

        if (toUpsert.length > 0) {
          await supabase
            .from("quote_brochures" as any)
            .upsert(toUpsert as any, { onConflict: "quote_id,brochure_id" });
        }

        await fetchAttached();
      } catch (e: any) {
        console.warn("Auto-match sync failed:", e.message);
      }
    })();
  }, [quoteId, lineItemModelCodes, allBrochures, fetchAttached]);

  // Manual add
  const addManualBrochure = useCallback(
    async (brochureId: string) => {
      if (!quoteId) return;
      try {
        const maxSort = attachedBrochures.reduce((m, a) => Math.max(m, a.sortOrder), 0);
        await supabase.from("quote_brochures" as any).upsert(
          {
            quote_id: quoteId,
            brochure_id: brochureId,
            is_auto_matched: false,
            sort_order: maxSort + 1,
          } as any,
          { onConflict: "quote_id,brochure_id" }
        );
        await fetchAttached();
      } catch (e: any) {
        setError(e.message);
      }
    },
    [quoteId, attachedBrochures, fetchAttached]
  );

  // Remove
  const removeBrochure = useCallback(
    async (linkId: string) => {
      try {
        await supabase.from("quote_brochures" as any).delete().eq("id", linkId);
        await fetchAttached();
      } catch (e: any) {
        setError(e.message);
      }
    },
    [fetchAttached]
  );

  // Reorder
  const reorderBrochures = useCallback(
    async (orderedLinkIds: string[]) => {
      try {
        await Promise.all(
          orderedLinkIds.map((id, i) =>
            supabase.from("quote_brochures" as any).update({ sort_order: i } as any).eq("id", id)
          )
        );
        await fetchAttached();
      } catch (e: any) {
        setError(e.message);
      }
    },
    [fetchAttached]
  );

  // Preview-only mode (no quoteId): compute matches without DB
  const previewMatches = quoteId
    ? []
    : computeAutoMatches(allBrochures, lineItemModelCodes).map((id) => {
        const b = allBrochures.find((br) => br.id === id)!;
        return { linkId: "", brochure: b, isAutoMatched: true, sortOrder: 0 } as AttachedBrochure;
      });

  return {
    attachedBrochures: quoteId ? attachedBrochures : previewMatches,
    allBrochures,
    loading,
    error,
    refresh: fetchAttached,
    addManualBrochure,
    removeBrochure,
    reorderBrochures,
  };
}
