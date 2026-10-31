import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isTestLead } from "@/lib/callSummary";
import { sortSteps, type NextStep } from "@/lib/nextSteps";

/** One shared list for the Next steps panel and the Jobs hub attention strip. Reps get only their own (enforced in SQL). */
export function useNextSteps(repId: string | null = null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["sales-next-steps", repId],
    refetchInterval: 60_000,
    queryFn: async (): Promise<NextStep[]> => {
      const { data, error } = await (supabase.rpc as any)("sales_next_steps", { p_rep: repId });
      if (error) throw error;
      return sortSteps(((data || []) as NextStep[]).filter((r) => !isTestLead(r.title)));
    },
  });
  const snooze = async (row: NextStep, opts: { until?: Date; dismiss?: boolean; reason: string }) => {
    const { error } = await (supabase.rpc as any)("snooze_next_step", {
      p_rule: row.rule, p_entity_type: row.entity_type, p_entity_id: row.entity_id,
      p_until: opts.until ? opts.until.toISOString() : null, p_dismiss: !!opts.dismiss, p_reason: opts.reason,
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["sales-next-steps"] });
  };
  return { rows: q.data || [], loading: q.isLoading, error: q.error, snooze };
}
