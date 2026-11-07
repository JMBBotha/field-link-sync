import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { countAdminHome, inSignedInCompany, type CountFigure } from "@/lib/adminHomeCount";
import { loadPackingList } from "@/lib/jobPack";
import { checkFromPackAndPlan, type MaterialsPlan } from "@/lib/materialCheckLoad";
import { checkKindOf, stockNeedsFromChecks, type CheckKind, type MaterialCheck, type SourceLine } from "@/lib/materialCheck";
import type { PackingRow } from "@/lib/packingList";
import { loadEntries, todayInJohannesburg } from "@/lib/todaysJobs";
import { useAdminHomeFigures, type AdminHomeSource } from "@/components/v8/AdminHomeFigures";

async function recordedParts(leadId: string | null | undefined): Promise<SourceLine[]> {
  if (!leadId) return [];
  const { data, error } = await (supabase.rpc as any)("get_job_used_parts", { p_lead_id: leadId });
  if (error || !Array.isArray(data)) return [];
  return (data as { id?: string; product_name?: string; product_code?: string; quantity?: number }[])
    .filter((p) => p.product_name)
    .map((p, i) => ({
      id: p.id || `used-${i}`,
      name: p.product_name,
      code: p.product_code || null,
      quantity: Number(p.quantity) || 1,
      source: "recorded" as const,
    }));
}

export async function loadMaterialCheck(jobId: string, kind: CheckKind, quoteHref: string | null, leadId?: string | null): Promise<MaterialCheck> {
  const [pack, planRes, recorded] = await Promise.all([
    loadPackingList(jobId).catch(() => [] as PackingRow[]),
    (supabase.rpc as any)("job_materials_plan", { p_job: jobId }).then((r: { data: MaterialsPlan | null; error: { message?: string } | null }) => (r.error ? null : r.data)).catch(() => null),
    recordedParts(leadId),
  ]);
  return checkFromPackAndPlan(kind, pack || [], planRes, quoteHref, recorded);
}

export function useMaterialCheck(jobId: string | null | undefined, kind: CheckKind, quoteId?: string | null, leadId?: string | null) {
  const href = quoteId ? `/admin/estimates/${quoteId}` : null;
  return useQuery({
    queryKey: ["role-material-check", jobId, kind, quoteId, leadId],
    enabled: !!jobId && kind !== "quote_visit",
    queryFn: () => loadMaterialCheck(jobId as string, kind, href, leadId),
  });
}

function weekEnd(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const weekday = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (weekday === 0 ? 1 : 8 - weekday));
  return dt.toISOString().slice(0, 10);
}

export function useAdminRoleData() {
  const { companyId } = useUserCompanyId();
  const figures = useAdminHomeFigures(companyId);
  const today = todayInJohannesburg();
  const crew = useQuery({
    queryKey: ["role-today-crew", companyId, today],
    enabled: !!companyId,
    queryFn: async () => {
      const entries = await loadEntries({ date: today });
      const jobIds = entries.map((e) => e.job_id).filter(Boolean) as string[];
      const agentIds = [...new Set(entries.map((e) => e.agent_id).filter(Boolean))] as string[];
      const [jobsRes, peopleRes] = await Promise.all([
        jobIds.length
          ? supabase.from("jobs").select("id, job_type, title, company_id, status").in("id", jobIds)
          : Promise.resolve({ data: [] as { id: string; job_type: string | null; title: string | null; company_id: string | null; status: string | null }[] }),
        agentIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", agentIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      ]);
      const jobs = new Map(((jobsRes.data || []) as { id: string; job_type: string | null; title: string | null; company_id: string | null; status: string | null }[])
        .filter((j) => inSignedInCompany(j.company_id, companyId) && j.status !== "cancelled")
        .map((j) => [j.id, j]));
      const names = new Map(((peopleRes.data || []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || "Technician"]));
      return entries
        .filter((e) => e.job_id && jobs.has(e.job_id))
        .map((e) => {
          const job = jobs.get(e.job_id as string)!;
          return {
            id: e.job_id as string,
            href: `/admin/jobs/${e.job_id}`,
            who: (e.agent_id && names.get(e.agent_id)) || "Unassigned",
            type: job.job_type || job.title || "Job",
            where: e.customer_address || job.title || "Job",
            client: e.customer_name || "Client",
          };
        });
    },
  });
  const needs = useQuery({
    queryKey: ["role-week-stock", companyId, today],
    enabled: !!companyId,
    queryFn: async () => {
      const end = weekEnd(today);
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, job_type, status, company_id, quote_id, lead_id, scheduled_for")
        .eq("company_id", companyId as string)
        .gte("scheduled_for", `${today}T00:00:00+02:00`)
        .lt("scheduled_for", `${end}T00:00:00+02:00`)
        .neq("status", "cancelled")
        .limit(12);
      if (error) throw error;
      const rows = ((data || []) as { id: string; title: string | null; job_type: string | null; company_id: string | null; quote_id: string | null; lead_id: string | null }[])
        .filter((j) => inSignedInCompany(j.company_id, companyId));
      const built = await Promise.all(rows.map(async (j) => {
        const kind = checkKindOf({ jobType: j.job_type, title: j.title });
        const href = `/admin/jobs/${j.id}`;
        const quoteHref = j.quote_id ? `/admin/estimates/${j.quote_id}` : href;
        const [pack, planRes, recorded] = await Promise.all([
          loadPackingList(j.id).catch(() => [] as PackingRow[]),
          (supabase.rpc as any)("job_materials_plan", { p_job: j.id }).then((r: { data: MaterialsPlan | null; error: unknown }) => (r.error ? null : r.data)).catch(() => null),
          recordedParts(j.lead_id),
        ]);
        return {
          href,
          kind,
          company_id: j.company_id,
          check: checkFromPackAndPlan(kind, pack || [], planRes, quoteHref, recorded),
        };
      }));
      return stockNeedsFromChecks(companyId as string, built);
    },
  });
  return { companyId, figures, crew, needs, source: figures.source as AdminHomeSource | undefined };
}

export function countsFor(companyId: string | null, source: AdminHomeSource | undefined) {
  if (!companyId || !source) return null;
  return countAdminHome({
    companyId,
    invoices: source.invoices,
    payments: source.payments,
    credits: source.credits,
    jobs: source.jobs,
  });
}

export type { CountFigure };
