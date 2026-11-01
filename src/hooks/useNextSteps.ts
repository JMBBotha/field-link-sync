import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isTestLead } from "@/lib/callSummary";
import { groupSteps, sortSteps, type NextStep, type QuoteMeta } from "@/lib/nextSteps";

/** One shared list for the Next steps panel and the Jobs hub attention strip. Reps get only their own (enforced in SQL). */
export function useNextSteps(repId: string | null = null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["sales-next-steps", repId],
    refetchInterval: 60_000,
    queryFn: async (): Promise<NextStep[]> => {
      const { data, error } = await (supabase.rpc as any)("sales_next_steps", { p_rep: repId });
      if (error) throw error;
      const rows = ((data || []) as NextStep[]).filter((r) => !isTestLead(r.title));
      const qids = [...new Set(rows.filter((r) => r.entity_type === "quote").map((r) => r.entity_id))];
      const meta: Record<string, QuoteMeta> = {};
      if (qids.length) {
        const { data: qs } = await (supabase.from("quotes") as any).select("id, option_group_id, quote_number, total, sent_at").in("id", qids);
        ((qs || []) as QuoteMeta[]).forEach((m) => { meta[m.id] = m; });
      }
      return sortSteps(groupSteps(rows, meta));
    },
  });
  const snooze = async (row: NextStep, opts: { until?: Date; dismiss?: boolean; reason: string }) => {
    // A grouped card snoozes every option in it.
    for (const r of row.options?.length ? row.options : [row]) {
      const { error } = await (supabase.rpc as any)("snooze_next_step", {
        p_rule: r.rule, p_entity_type: r.entity_type, p_entity_id: r.entity_id,
        p_until: opts.until ? opts.until.toISOString() : null, p_dismiss: !!opts.dismiss, p_reason: opts.reason,
      });
      if (error) throw error;
    }
    await qc.invalidateQueries({ queryKey: ["sales-next-steps"] });
  };
  const groupWith = async (quoteId: string, otherId: string) => {
    const { error } = await (supabase.rpc as any)("group_quote_option", { p_quote: quoteId, p_other: otherId });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["sales-next-steps"] });
  };
  const ungroup = async (quoteId: string) => {
    const { error } = await (supabase.rpc as any)("ungroup_quote_option", { p_quote: quoteId });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["sales-next-steps"] });
  };
  return { rows: q.data || [], loading: q.isLoading, error: q.error, snooze, groupWith, ungroup };
}
