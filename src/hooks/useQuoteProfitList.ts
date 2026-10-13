import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Per-quote profit row from get_company_quote_profit (server decides who sees what). */
export interface QuoteProfitRow {
  quote_id: string; sell_ex_vat: number | null; cost: number | null; lines_total: number; lines_costed: number;
  commission: number | null; company_profit: number | null; rep_id: string | null; full_view: boolean;
}

/**
 * Quotes list profit columns (Johan 13 Oct 2026). Admin/owner: all four figures. Rep: own commission only.
 * Techs / others: the server returns no rows, so the columns stay hidden.
 */
export function useQuoteProfitList(companyIds: string[]) {
  const ids = [...new Set(companyIds.filter(Boolean))].sort();
  const { data } = useQuery({
    queryKey: ["quote-profit-list", ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const out: Record<string, QuoteProfitRow> = {};
      for (const id of ids) {
        const { data: rows, error } = await (supabase.rpc as any)("get_company_quote_profit", { p_company_id: id });
        if (error) continue;
        for (const r of (rows || []) as QuoteProfitRow[]) out[r.quote_id] = r;
      }
      return out;
    },
  });
  const map = data ?? {};
  const rows = Object.values(map);
  return { map, show: rows.length > 0, full: rows.some((r) => r.full_view) };
}

/** "X of Y costed" when any line lacks a cost; null when fully costed. */
export const costedLabel = (r: Pick<QuoteProfitRow, "lines_total" | "lines_costed">) =>
  r.lines_total === 0 ? "No lines" : r.lines_costed === 0 ? "Add costs" : r.lines_costed < r.lines_total ? `${r.lines_costed} of ${r.lines_total} costed` : null;
