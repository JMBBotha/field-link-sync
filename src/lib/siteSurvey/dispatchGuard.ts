/**
 * Dispatch guard (Johan default 1): an install quoted after a site visit (not a phone/online quote) needs a
 * completed site survey before a technician is assigned. Only quotes created from SURVEY_REQUIRED_FROM on,
 * so jobs already in the pipeline are never blocked.
 */
import { supabase } from "@/integrations/supabase/client";

export const SURVEY_REQUIRED_FROM = "2026-10-19T00:00:00+02:00";

export function surveyRequired(x: { has_install: boolean; remote_quote: boolean; quote_created_at: string | null; survey_status: string | null }): boolean {
  if (!x.has_install || x.remote_quote || !x.quote_created_at) return false;
  if (new Date(x.quote_created_at).getTime() < new Date(SURVEY_REQUIRED_FROM).getTime()) return false;
  return x.survey_status !== "complete";
}

/** null = OK to dispatch; otherwise the reason to show. Fails open on lookup errors (RLS still applies). */
export async function surveyDispatchBlock(jobId: string): Promise<{ reason: string; leadId: string | null } | null> {
  try {
    const { data: job } = await (supabase as any).from("jobs").select("lead_id, quote_id, quotes:quote_id(created_at)").eq("id", jobId).maybeSingle();
    if (!job?.quote_id) return null;
    const { data: sc, error } = await (supabase.rpc as any)("get_job_site_check", { p_job_id: jobId });
    if (error || !sc) return null;
    let survey_status: string | null = null;
    if (job.lead_id) {
      const { data: s } = await (supabase as any).from("site_surveys").select("status").eq("lead_id", job.lead_id).is("archived_at", null).maybeSingle();
      survey_status = s?.status ?? null;
    }
    const need = surveyRequired({ has_install: !!sc.has_install, remote_quote: !!sc.remote_quote, quote_created_at: job.quotes?.created_at ?? null, survey_status });
    return need ? { reason: "This install was quoted after a site visit: finish the site survey before dispatching a technician.", leadId: job.lead_id ?? null } : null;
  } catch {
    return null;
  }
}
