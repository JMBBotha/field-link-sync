import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { quoteUnitBriefParts, type BriefLine, type UnitBrief } from "@/lib/quoteUnitBrief";

/** Read-only unit summary per quote id (company-scoped by RLS on quote_items). */
export function useQuoteUnitBriefs(ids: string[]) {
  const key = [...ids].sort().join(",");
  const { data = {} } = useQuery({
    queryKey: ["quote-unit-briefs", key],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const by: Record<string, BriefLine[]> = {};
      for (let i = 0; i < ids.length; i += 150) {
        const { data: rows, error } = await supabase.from("quote_items")
          .select("quote_id, item_name, item_type, quantity, parent_item_id, metadata").in("quote_id", ids.slice(i, i + 150));
        if (error) throw error;
        for (const l of (rows || []) as unknown as BriefLine[]) (by[l.quote_id as string] ||= []).push(l);
      }
      const out: Record<string, UnitBrief> = {};
      for (const id of ids) { const b = quoteUnitBriefParts(by[id] || []); if (b) out[id] = b; }
      return out;
    },
  });
  return data as Record<string, UnitBrief>;
}
