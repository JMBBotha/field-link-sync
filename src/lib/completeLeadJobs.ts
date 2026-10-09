import { supabase } from "@/integrations/supabase/client";

/** Job statuses that a completion sign-off should close. */
export const OPEN_JOB_STATUSES = ["scheduled", "dispatched", "in_progress"] as const;

/**
 * Open jobs linked to a lead that the caller can see (RLS: techs only see their assigned jobs).
 * Used to give the completion record a job_id and to close the jobs row(s).
 */
export async function findOpenJobIdsForLead(leadId: string): Promise<string[]> {
  if (!leadId) return [];
  const { data, error } = await supabase
    .from("jobs")
    .select("id, created_at")
    .eq("lead_id", leadId)
    .in("status", OPEN_JOB_STATUSES as unknown as string[])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as { id: string }[] | null) || []).map((j) => j.id);
}

/**
 * Close the job row(s) for a completed lead. For techs the DB trigger on leads already completes their
 * assigned job + assignment, so this matches 0 rows; for office close-outs (no tech assignment) it is
 * what actually completes the job (tech ledger / draft balance invoice triggers then run server-side).
 */
export async function completeJobsForLead(leadId: string, jobId?: string | null): Promise<void> {
  const ids = jobId ? [jobId] : await findOpenJobIdsForLead(leadId);
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("jobs")
    .update({ status: "completed" })
    .in("id", ids)
    .in("status", OPEN_JOB_STATUSES as unknown as string[]);
  if (error) throw error;
}
